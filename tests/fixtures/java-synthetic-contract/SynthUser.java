// Synthetic field-contract POJO for the java-synthetic-contract demo.
//
// Plain JDK only: no framework annotation, no generated code, no database.
// The five properties below ARE the field contract that the mapper xml
// document and the contract probe both verify.
public class SynthUser {

    private long id;
    private String username;
    private String email;
    private String status;
    private String createdAt;

    public SynthUser() {
    }

    public SynthUser(String username, String email, String status, String createdAt) {
        this.username = username;
        this.email = email;
        this.status = status;
        this.createdAt = createdAt;
    }

    public long getId() {
        return id;
    }

    public void setId(long id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(String createdAt) {
        this.createdAt = createdAt;
    }

    // Full-state equality used by the probe to compare stored copies.
    public boolean sameState(SynthUser other) {
        if (other == null) {
            return false;
        }
        return id == other.id
            && eq(username, other.username)
            && eq(email, other.email)
            && eq(status, other.status)
            && eq(createdAt, other.createdAt);
    }

    private static boolean eq(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }
}
