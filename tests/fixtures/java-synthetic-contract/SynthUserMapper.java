// Synthetic Mapper layer for the java-synthetic-contract demo: the interface
// plus one local in-memory implementation of it.
//
// Plain JDK only. Nothing here runs MyBatis or any other framework; the
// begin/commit/rollback trio simulates a real mapper's transaction with an
// in-memory snapshot so the probe can verify rollback semantics for real.
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public interface SynthUserMapper {

    SynthUser selectById(long id);

    List<SynthUser> selectPage(long offset, int limit);

    long insert(SynthUser row);

    int deleteById(long id);

    long countAll();

    void begin();

    void commit();

    void rollback();
}

class InMemorySynthUserMapper implements SynthUserMapper {

    private final LinkedHashMap<Long, SynthUser> store = new LinkedHashMap<Long, SynthUser>();
    private long nextId = 1L;
    private boolean txActive = false;
    private Map<Long, SynthUser> txBackup = null;

    public SynthUser selectById(long id) {
        SynthUser row = store.get(id);
        return row == null ? null : copy(row);
    }

    public List<SynthUser> selectPage(long offset, int limit) {
        if (offset < 0 || limit <= 0) {
            throw new IllegalArgumentException("bad offset/limit");
        }
        List<SynthUser> page = new ArrayList<SynthUser>();
        long skipped = 0;
        for (SynthUser row : store.values()) {
            if (skipped < offset) {
                skipped++;
                continue;
            }
            if (page.size() >= limit) {
                break;
            }
            page.add(copy(row));
        }
        return page;
    }

    public long insert(SynthUser row) {
        if (row == null) {
            throw new IllegalArgumentException("row is null");
        }
        long id = nextId++;
        SynthUser stored = copy(row);
        stored.setId(id);
        store.put(id, stored);
        row.setId(id); // write the generated key back, like a real mapper would
        return id;
    }

    public int deleteById(long id) {
        return store.remove(id) == null ? 0 : 1;
    }

    public long countAll() {
        return store.size();
    }

    // Snapshot transaction: begin copies the store, rollback restores it,
    // commit simply drops the backup. nextId is not rolled back, mirroring
    // how real database sequences behave.
    public void begin() {
        if (txActive) {
            throw new IllegalStateException("transaction already active");
        }
        txActive = true;
        txBackup = new HashMap<Long, SynthUser>();
        for (Map.Entry<Long, SynthUser> entry : store.entrySet()) {
            txBackup.put(entry.getKey(), copy(entry.getValue()));
        }
    }

    public void commit() {
        if (!txActive) {
            throw new IllegalStateException("no active transaction");
        }
        txActive = false;
        txBackup = null;
    }

    public void rollback() {
        if (!txActive) {
            throw new IllegalStateException("no active transaction");
        }
        store.clear();
        store.putAll(txBackup);
        txActive = false;
        txBackup = null;
    }

    private static SynthUser copy(SynthUser src) {
        SynthUser dst = new SynthUser();
        dst.setId(src.getId());
        dst.setUsername(src.getUsername());
        dst.setEmail(src.getEmail());
        dst.setStatus(src.getStatus());
        dst.setCreatedAt(src.getCreatedAt());
        return dst;
    }
}
