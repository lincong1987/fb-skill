import argparse
import hashlib
import json
import pathlib
import re
import stat
import tarfile
import zipfile

# Same forbidden-material blacklist as scripts/pack-release-validation.cjs (parity, not a second policy).
FORBIDDEN_MEMBER_RE = re.compile(
    r"^(?:tests|evals|\.validation-output|node_modules|\.agents)/"
    r"|reverse-requirements-feasibility|reverse-requirements-pilot|release-validation"
    r"|\.zip$|\.tgz$")


def main():
    parser = argparse.ArgumentParser(description="Create and verify a ZIP from the reviewed FB Skill package")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    manifest_file = pathlib.Path(args.manifest)
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if manifest["name"] != "fb-skill" or manifest["version"] != "0.2.1":
        raise RuntimeError("Unexpected package identity")
    bundle = pathlib.Path(manifest["bundle"])
    seen_paths = set()
    for entry in manifest["packedFiles"]:
        if FORBIDDEN_MEMBER_RE.search(entry["path"]):
            raise RuntimeError("Forbidden package member: " + entry["path"])
        if entry["path"] in seen_paths:
            raise RuntimeError("Duplicate package member path: " + entry["path"])
        seen_paths.add(entry["path"])
    expected = {entry["path"]: entry for entry in manifest["packedFiles"]}
    output = pathlib.Path(args.output)
    if output.exists() or output.is_symlink():
        raise RuntimeError("Output already exists; refusing to overwrite")
    files = {}
    for relative, entry in expected.items():
        path = pathlib.PurePosixPath(relative)
        if path.is_absolute() or any(part in (".", "..") for part in path.parts) or "\\" in relative or ":" in relative:
            raise RuntimeError("Unsafe package member")
        source = bundle.joinpath(*path.parts)
        for parent in [bundle, *source.parents]:
            if parent == bundle.parent:
                break
            if parent.is_symlink():
                raise RuntimeError("Linked package path")
        info = source.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink > 1:
            raise RuntimeError("Package member is not an independent regular file")
        data = source.read_bytes()
        if len(data) != entry["size"]:
            raise RuntimeError("Package size drift: " + relative)
        files["fb-skill/" + relative] = data
    tgz = pathlib.Path(manifest["file"])
    if tgz.is_symlink() or hashlib.sha256(tgz.read_bytes()).hexdigest() != manifest["sha256"]:
        raise RuntimeError("Reviewed archive hash drift")
    with tarfile.open(tgz, "r:gz") as archive:
        members = [member for member in archive.getmembers() if not member.isdir()]
        if any(not member.isfile() for member in members):
            raise RuntimeError("Archive contains non-regular members")
        names = [member.name for member in members]
        if len(set(names)) != len(names) or set(names) != {"package/" + name for name in expected}:
            raise RuntimeError("Archive member list differs")
        for member in members:
            content = archive.extractfile(member)
            if content is None or content.read() != files["fb-skill/" + member.name[len("package/"):]]:
                raise RuntimeError("Archive and ZIP source bytes differ")
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 11, 22, 0, 0, 0))
            info.create_system = 3
            mode = expected[name[len("fb-skill/"):]]["mode"]
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    with zipfile.ZipFile(output, "r") as archive:
        if set(archive.namelist()) != set(files) or archive.testzip() is not None:
            raise RuntimeError("ZIP verification failed")
        for name, data in files.items():
            if archive.read(name) != data:
                raise RuntimeError("ZIP bytes differ: " + name)
    payload = output.read_bytes()
    print(json.dumps({"file": str(output), "bytes": len(payload),
                      "sha256": hashlib.sha256(payload).hexdigest(),
                      "files": len(files), "verified": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
