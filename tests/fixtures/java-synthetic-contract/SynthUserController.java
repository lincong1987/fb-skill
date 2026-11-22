// Synthetic Controller layer for the java-synthetic-contract demo: explicit
// role check plus delegation to the service interface.
//
// Plain Java only. There is no Spring annotation and no Spring runtime; the
// role arrives as a plain parameter so the authorization contract can be
// exercised by a bare main() probe.
import java.util.List;

public class SynthUserController {

    private final SynthUserService service;

    public SynthUserController(SynthUserService service) {
        this.service = service;
    }

    public SynthUser getUser(long id, String role) {
        requireRole(role);
        return service.getById(id);
    }

    public List<SynthUser> listUsers(int page, int size, String role) {
        requireRole(role);
        return service.listPage(page, size);
    }

    public SynthUser createUser(SynthUser draft, String role) {
        requireRole(role);
        return service.createUser(draft);
    }

    public int deleteUser(long id, String role) {
        requireRole(role);
        return service.removeUser(id);
    }

    // Authorization contract: only "admin" passes; any other role is rejected
    // before the service is ever reached. Service-level exceptions (missing
    // record, validation) propagate through unchanged.
    private static void requireRole(String role) {
        if (!"admin".equals(role)) {
            throw new SynthForbiddenException("role not allowed: " + role);
        }
    }
}

class SynthForbiddenException extends RuntimeException {

    SynthForbiddenException(String message) {
        super(message);
    }
}
