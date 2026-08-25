CREATE SEQUENCE IF NOT EXISTS biometric_adms_command_id_seq;

SELECT setval(
  'biometric_adms_command_id_seq',
  GREATEST(COALESCE((SELECT MAX(adms_command_id) FROM biometric_device_commands), 0), 1),
  COALESCE((SELECT MAX(adms_command_id) FROM biometric_device_commands), 0) > 0
);
