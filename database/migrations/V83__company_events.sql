-- Company events: celebrations, meetings, training sessions and anything else
-- worth putting on the calendar.
--
-- Deliberately NOT the holidays table. A holiday there means a non-working day,
-- and payroll, loss-of-pay and the work-report reminder all read it that way; a
-- training session filed as a holiday would quietly stop being a working day for
-- every one of them. These sit beside holidays and change nothing about pay or
-- attendance.
CREATE TABLE company_events (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    title         VARCHAR(200) NOT NULL,
    description   TEXT         NULL,
    -- CELEBRATION | MEETING | TRAINING | OTHER
    event_type    VARCHAR(30)  NOT NULL,
    event_date    DATE         NOT NULL,
    -- Set only when it runs over more than one day, as training often does.
    end_date      DATE         NULL,
    start_time    TIME         NULL,
    end_time      TIME         NULL,
    location      VARCHAR(200) NULL,
    -- Null means the whole company; a team name limits it to that team.
    audience_team VARCHAR(150) NULL,
    created_by    BIGINT       NULL,
    created_at    DATETIME     NOT NULL
);

CREATE INDEX idx_company_event_date ON company_events (event_date);
CREATE INDEX idx_company_event_type ON company_events (event_type, event_date);
