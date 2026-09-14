-- Appreciation letters: HR, an administrator or the CTO writes one about an
-- employee, and the employee receives it.
--
-- The mirror image of a discipline record, and deliberately its own table
-- rather than a flag on one: they are read by different people for different
-- reasons, and nobody wants a query that has to say "the good ones".
CREATE TABLE appreciation_letters (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    reference_code  VARCHAR(30)  NOT NULL UNIQUE,       -- AL-2026-00001

    employee_id     BIGINT       NOT NULL,              -- who it is for
    issued_by       BIGINT       NOT NULL,              -- who wrote it

    letter_date     DATE         NOT NULL,
    achievement     VARCHAR(120) NOT NULL,              -- Outstanding Performance ...
    message         TEXT         NOT NULL,
    template        VARCHAR(40)  NOT NULL DEFAULT 'CLASSIC',

    -- DRAFT until sent, then SENT. Viewed and downloaded are recorded as they
    -- happen so the issuer can see the letter actually landed.
    status          VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
    viewed_at       DATETIME,
    downloaded_at   DATETIME,

    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_appreciation_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_appreciation_issuer FOREIGN KEY (issued_by) REFERENCES users(id),
    INDEX idx_appreciation_employee (employee_id),
    INDEX idx_appreciation_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
