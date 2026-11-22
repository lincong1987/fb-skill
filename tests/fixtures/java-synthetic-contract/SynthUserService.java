// Synthetic Service layer for the java-synthetic-contract demo: interface,
// local implementation and the service-level contract exceptions.
//
// Plain JDK only; no Spring/MyBatis runtime is involved or claimed. The
// implementation depends on the SynthUserMapper INTERFACE, not on the
// in-memory class, so the layering stays honest.
import java.util.List;

public interface SynthUserService {

    SynthUser getById(long id);

    List<SynthUser> listPage(int page, int size);

    SynthUser createUser(SynthUser draft);

    int removeUser(long id);

    void createPairTransactional(SynthUser first, SynthUser second);

    long countUsers();
}

class SynthValidationException extends RuntimeException {

    SynthValidationException(String message) {
        super(message);
    }
}

class SynthNotFoundException extends RuntimeException {

    SynthNotFoundException(long id) {
        super("synth user not found: id=" + id);
    }
}

class SynthUserServiceImpl implements SynthUserService {

    private final SynthUserMapper mapper;

    SynthUserServiceImpl(SynthUserMapper mapper) {
        this.mapper = mapper;
    }

    public SynthUser getById(long id) {
        SynthUser row = mapper.selectById(id);
        if (row == null) {
            throw new SynthNotFoundException(id);
        }
        return row;
    }

    // Pagination contract: page is 1-based, size >= 1, stable id order.
    public List<SynthUser> listPage(int page, int size) {
        if (page < 1) {
            throw new SynthValidationException("page must be >= 1");
        }
        if (size < 1) {
            throw new SynthValidationException("size must be >= 1");
        }
        return mapper.selectPage((long) (page - 1) * size, size);
    }

    // Required-field contract: username/email/status are required and email
    // must carry an '@'.
    public SynthUser createUser(SynthUser draft) {
        validateDraft(draft);
        mapper.insert(draft);
        return draft;
    }

    public int removeUser(long id) {
        if (mapper.selectById(id) == null) {
            throw new SynthNotFoundException(id);
        }
        return mapper.deleteById(id);
    }

    // Transaction demo: the first row is validated and inserted, then the
    // second one. Any failure after that point (invalid second draft,
    // duplicate username) rolls the whole pair back via the mapper snapshot.
    public void createPairTransactional(SynthUser first, SynthUser second) {
        mapper.begin();
        try {
            validateDraft(first);
            mapper.insert(first);
            validateDraft(second);
            mapper.insert(second);
            if (first.getUsername().equals(second.getUsername())) {
                throw new SynthValidationException("duplicate username inside transaction");
            }
            mapper.commit();
        } catch (RuntimeException e) {
            mapper.rollback();
            throw e;
        }
    }

    public long countUsers() {
        return mapper.countAll();
    }

    private static void validateDraft(SynthUser draft) {
        if (draft == null) {
            throw new SynthValidationException("draft is null");
        }
        if (isBlank(draft.getUsername())) {
            throw new SynthValidationException("username is required");
        }
        if (isBlank(draft.getEmail())) {
            throw new SynthValidationException("email is required");
        }
        if (draft.getEmail().indexOf('@') < 0) {
            throw new SynthValidationException("email must contain @");
        }
        if (isBlank(draft.getStatus())) {
            throw new SynthValidationException("status is required");
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().length() == 0;
    }
}
