DROP FUNCTION IF EXISTS notifications.is_critical_class(text);
DROP FUNCTION IF EXISTS notifications.due_priority(text);
DROP TABLE IF EXISTS notifications.notification_dead_letter_evidence;
DROP TABLE IF EXISTS notifications.notification_user_preference;
DROP TABLE IF EXISTS notifications.notification_delivery_attempt;
DROP TABLE IF EXISTS notifications.notification_intent;
DROP TABLE IF EXISTS notifications.notification_template;
DROP SCHEMA IF EXISTS notifications;