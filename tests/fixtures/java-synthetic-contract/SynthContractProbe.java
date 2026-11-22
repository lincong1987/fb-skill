// Synthetic contract probe for the java-synthetic-contract demo.
//
// Bare main() under a plain JDK: no database, no network, no framework, no
// application server. It exercises the whole synthetic stack and prints one
// PASS/FAIL line per check plus a final TOTAL line:
//   1. field contract       - reflection over the POJO's fields/accessors
//   2. pagination           - real pages from the in-memory mapper
//   3. required fields      - service-level validation
//   4. authorization        - controller rejects non-admin roles
//   5. missing record       - mapper null / service + controller exception
//   6. transaction rollback - failed pair inserts leave the store unchanged
//   7. xml mapping contract - TEXT checks only against the mapping document
// The xml file is never parsed or loaded by any framework; only its text is
// compared. Exit code is 0 when every check passed, 1 otherwise.
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class SynthContractProbe {

    private static int pass = 0;
    private static int fail = 0;

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            fail++;
            System.out.println("FAIL probe.args detail=missing xml mapping path");
            System.out.println("TOTAL pass=" + pass + " fail=" + fail);
            System.exit(1);
            return;
        }
        checkFieldContract();
        checkPagination();
        checkRequiredFields();
        checkAuthorization();
        checkMissingRecord();
        checkTransactionRollback();
        checkXmlMappingText(args[0]);
        System.out.println("TOTAL pass=" + pass + " fail=" + fail);
        System.exit(fail == 0 ? 0 : 1);
    }

    private static void check(String id, boolean ok, String detail) {
        if (ok) {
            pass++;
            System.out.println("PASS " + id);
        } else {
            fail++;
            System.out.println("FAIL " + id + (detail.length() > 0 ? " detail=" + detail : ""));
        }
    }

    private static void checkFieldContract() {
        Set<String> expected = new HashSet<String>(Arrays.asList("id", "username", "email", "status", "createdAt"));
        Set<String> actual = new HashSet<String>();
        for (Field f : SynthUser.class.getDeclaredFields()) {
            actual.add(f.getName());
        }
        check("fields.names", actual.equals(expected), "actual=" + actual);

        boolean typesOk = true;
        for (Field f : SynthUser.class.getDeclaredFields()) {
            if ("id".equals(f.getName())) {
                typesOk = typesOk && f.getType() == long.class;
            } else {
                typesOk = typesOk && f.getType() == String.class;
            }
        }
        check("fields.types", typesOk, "");

        Set<String> methods = new HashSet<String>();
        for (Method m : SynthUser.class.getDeclaredMethods()) {
            methods.add(m.getName());
        }
        check("fields.accessors", methods.containsAll(Arrays.asList(
            "getId", "setId", "getUsername", "setUsername", "getEmail", "setEmail",
            "getStatus", "setStatus", "getCreatedAt", "setCreatedAt")), "");

        SynthUser u = new SynthUser("alice", "alice@example.com", "ACTIVE", "2026-01-01 00:00:00");
        u.setId(42L);
        check("fields.roundtrip", u.getId() == 42L
            && "alice".equals(u.getUsername())
            && "alice@example.com".equals(u.getEmail())
            && "ACTIVE".equals(u.getStatus())
            && "2026-01-01 00:00:00".equals(u.getCreatedAt()), "");
    }

    private static void checkPagination() {
        final SynthUserService svc = newService(7);
        List<Long> p1 = idsOf(svc.listPage(1, 3));
        check("page.first", p1.equals(Arrays.asList(1L, 2L, 3L)), p1.toString());
        List<Long> p2 = idsOf(svc.listPage(2, 3));
        check("page.second", p2.equals(Arrays.asList(4L, 5L, 6L)), p2.toString());
        List<Long> p3 = idsOf(svc.listPage(3, 3));
        check("page.last-partial", p3.equals(Arrays.asList(7L)), p3.toString());
        List<Long> p4 = idsOf(svc.listPage(4, 3));
        check("page.empty-tail", p4.isEmpty(), p4.toString());
        check("page.invalid-page-rejected", throwsValidation(() -> svc.listPage(0, 3)), "");
        check("page.invalid-size-rejected", throwsValidation(() -> svc.listPage(1, 0)), "");
    }

    private static void checkRequiredFields() {
        final SynthUserService svc = newService(0);
        check("required.null-draft-rejected", throwsValidation(() -> svc.createUser(null)), "");
        check("required.username-blank-rejected", throwsValidation(() -> svc.createUser(new SynthUser("", "a@example.com", "ACTIVE", "t"))), "");
        check("required.email-missing-rejected", throwsValidation(() -> svc.createUser(new SynthUser("u", null, "ACTIVE", "t"))), "");
        check("required.email-format-rejected", throwsValidation(() -> svc.createUser(new SynthUser("u", "not-an-email", "ACTIVE", "t"))), "");
        check("required.status-blank-rejected", throwsValidation(() -> svc.createUser(new SynthUser("u", "u@example.com", " ", "t"))), "");

        SynthUser saved = svc.createUser(new SynthUser("bob", "bob@example.com", "ACTIVE", "2026-01-02 00:00:00"));
        check("required.valid-create-assigns-id", saved.getId() == 1L, "id=" + saved.getId());
        check("required.valid-create-readable", svc.getById(saved.getId()).sameState(saved), "");
    }

    private static void checkAuthorization() {
        final SynthUserService svc = newService(2);
        final SynthUserController controller = new SynthUserController(svc);
        check("authz.guest-read-forbidden", throwsForbidden(() -> controller.getUser(1L, "guest")), "");
        check("authz.guest-delete-forbidden", throwsForbidden(() -> controller.deleteUser(1L, "guest")), "");
        check("authz.guest-create-forbidden", throwsForbidden(() -> controller.createUser(new SynthUser("eve", "eve@example.com", "ACTIVE", "t"), "guest")), "");
        SynthUser adminRead = controller.getUser(1L, "admin");
        check("authz.admin-read-allowed", adminRead != null && adminRead.getId() == 1L, "");
        check("authz.forbidden-leaves-store-intact", svc.countUsers() == 2L, "count=" + svc.countUsers());
    }

    private static void checkMissingRecord() {
        final SynthUserService svc = newService(1);
        final SynthUserController controller = new SynthUserController(svc);
        check("missing.mapper-returns-null", new InMemorySynthUserMapper().selectById(999L) == null, "");
        check("missing.service-throws", throwsNotFound(() -> svc.getById(999L)), "");
        check("missing.controller-propagates", throwsNotFound(() -> controller.getUser(999L, "admin")), "");
        check("missing.delete-throws", throwsNotFound(() -> controller.deleteUser(999L, "admin")), "");
    }

    private static void checkTransactionRollback() {
        InMemorySynthUserMapper mapper = new InMemorySynthUserMapper();
        SynthUserService svc = new SynthUserServiceImpl(mapper);

        // Failure after a real insert: the second draft misses a required
        // field, so the already-inserted first row must be rolled back again.
        SynthUser a = new SynthUser("carol", "carol@example.com", "ACTIVE", "2026-01-03 00:00:00");
        SynthUser b = new SynthUser("dave", "dave@example.com", " ", "2026-01-03 00:00:00");
        boolean invalidRejected = false;
        try {
            svc.createPairTransactional(a, b);
        } catch (SynthValidationException e) {
            invalidRejected = true;
        }
        check("tx.validation-failure-rejected", invalidRejected, "");
        check("tx.validation-rollback-empty", mapper.countAll() == 0L, "count=" + mapper.countAll());
        check("tx.validation-rollback-no-first-row", mapper.selectById(a.getId()) == null, "");

        SynthUser c = new SynthUser("erin", "erin@example.com", "ACTIVE", "2026-01-04 00:00:00");
        SynthUser d = new SynthUser("frank", "frank@example.com", "ACTIVE", "2026-01-04 00:00:00");
        svc.createPairTransactional(c, d);
        check("tx.success-count", mapper.countAll() == 2L, "count=" + mapper.countAll());
        check("tx.success-rows-present", mapper.selectById(c.getId()) != null && mapper.selectById(d.getId()) != null, "");

        // Second failure trigger: duplicate username inside the same pair.
        SynthUser e2 = new SynthUser("gina", "gina@example.com", "ACTIVE", "2026-01-05 00:00:00");
        SynthUser f = new SynthUser("gina", "gina@example.com", "ACTIVE", "2026-01-05 00:00:00");
        boolean dupRejected = false;
        try {
            svc.createPairTransactional(e2, f);
        } catch (SynthValidationException ex) {
            dupRejected = true;
        }
        check("tx.duplicate-rejected", dupRejected, "");
        check("tx.duplicate-rollback-count", mapper.countAll() == 2L, "count=" + mapper.countAll());
    }

    private static void checkXmlMappingText(String xmlPath) throws Exception {
        String xml = new String(Files.readAllBytes(Paths.get(xmlPath)), StandardCharsets.UTF_8);
        check("xml.text-only-marker", xml.contains("text-only field-mapping contract"), "");
        check("xml.resultmap-header", xml.contains("<resultMap id=\"SynthUserResultMap\" type=\"SynthUser\">"), "");
        check("xml.pair.id", xml.contains("<id property=\"id\" column=\"id\" />"), "");
        check("xml.pair.username", xml.contains("<result property=\"username\" column=\"username\" />"), "");
        check("xml.pair.email", xml.contains("<result property=\"email\" column=\"email\" />"), "");
        check("xml.pair.status", xml.contains("<result property=\"status\" column=\"status\" />"), "");
        check("xml.pair.createdAt", xml.contains("<result property=\"createdAt\" column=\"created_at\" />"), "");
        check("xml.pair-count", countOf(xml, "<result ") == 4 && countOf(xml, "<id ") == 1,
            "results=" + countOf(xml, "<result ") + " ids=" + countOf(xml, "<id "));
        check("xml.insert-columns", xml.contains("username, email, status, created_at"), "");
        check("xml.select-limit", xml.contains("LIMIT #{offset}, #{size}"), "");
    }

    private static SynthUserService newService(int seedRows) {
        SynthUserService svc = new SynthUserServiceImpl(new InMemorySynthUserMapper());
        for (int i = 1; i <= seedRows; i++) {
            svc.createUser(new SynthUser("user" + i, "user" + i + "@example.com", "ACTIVE", "2026-01-01 00:00:0" + i));
        }
        return svc;
    }

    private static List<Long> idsOf(List<SynthUser> rows) {
        List<Long> ids = new ArrayList<Long>();
        for (SynthUser row : rows) {
            ids.add(row.getId());
        }
        return ids;
    }

    private static boolean throwsValidation(Runnable r) {
        try {
            r.run();
            return false;
        } catch (SynthValidationException e) {
            return true;
        }
    }

    private static boolean throwsForbidden(Runnable r) {
        try {
            r.run();
            return false;
        } catch (SynthForbiddenException e) {
            return true;
        }
    }

    private static boolean throwsNotFound(Runnable r) {
        try {
            r.run();
            return false;
        } catch (SynthNotFoundException e) {
            return true;
        }
    }

    private static int countOf(String haystack, String needle) {
        int count = 0;
        int idx = 0;
        while ((idx = haystack.indexOf(needle, idx)) >= 0) {
            count++;
            idx += needle.length();
        }
        return count;
    }
}
