-- ============================================================
-- V145 - The HR account holds the HR role.
--
-- The account everybody calls HR -- username "hr", employee HR0001 -- holds
-- IT_MGR and does not hold IT_HR. That was invisible until both accounts were
-- called endpoint by endpoint and two came back differently:
--
--   /api/wfh/all                     HR 403, PIX-E058 200
--   /api/discipline/pending-review   HR 403, PIX-E058 200
--
-- Both want USER_MANAGE. IT_HR carries it and IT_MGR does not, so the person
-- whose whole job is HR could not see the work-from-home queue or the
-- disciplinary reviews waiting on them, while a colleague granted IT_HR could.
--
-- Comparing the two roles on the live data, IT_MGR lacks exactly two of the
-- permissions the code checks: USER_MANAGE and ORG_MANAGE. Everything else
-- matches.
--
-- WHY GRANT THE ROLE RATHER THAN THE TWO PERMISSIONS
--
-- Adding USER_MANAGE and ORG_MANAGE to IT_MGR would reach every account holding
-- it, which is four -- including one whose job is not HR. Granting IT_HR to the
-- one account that needs it changes one person's access and leaves the manager
-- role alone.
--
-- It also makes the data say what the code already assumes. Every service that
-- asks "is this person HR" tests IT_MGR, IT_HR and CV_HR together, so the two
-- roles were already one desk everywhere except in the grants.
--
-- IT_MGR IS KEPT. Roles add up, and IT_MGR carries HELPDESK_RAISE, LEAVE_APPLY
-- and PAYROLL_VIEW -- the things HR needs as an employee rather than as HR.
-- (V143 gives those to IT_HR as well, so this is belt and braces.)
--
-- Matched on employee_code, not on a row id: ids differ between the copy this
-- was written against and the live database, and a migration that grants HR to
-- whoever happens to be user 71 elsewhere grants HR to a stranger.
--
-- ADDITIVE. One grant, guarded so re-running changes nothing.
-- ============================================================

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code = 'IT_HR'
WHERE u.employee_code = 'HR0001'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = u.id AND ur.role_id = r.id
  );

-- Verification -- all must hold:
--   SELECT u.employee_code, GROUP_CONCAT(r.code ORDER BY r.code) FROM users u
--     JOIN user_roles ur ON ur.user_id = u.id
--     JOIN roles r ON r.id = ur.role_id
--    WHERE u.employee_code IN ('HR0001','PIX-E058') GROUP BY u.id;
--   -- HR0001: IT_HR, IT_MGR   PIX-E058: IT_EMP, IT_HR
--
--   Then, as each of them: /api/wfh/all and /api/discipline/pending-review
--   both answer 200.
