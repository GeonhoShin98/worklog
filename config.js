/*
 * Supabase publishable key는 브라우저에서 공개되는 값입니다.
 * service_role 또는 secret 키는 이 파일에 절대 넣지 마세요.
 */
window.WORKLOG_CONFIG = Object.freeze({
  SUPABASE_URL: "https://qvkyfrmwcqhqwccsikbl.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_kNJKGSQFF3SgUf_13ESx1Q_HH3v02Bn",
  WORKLOG_TABLE: "worklog",
  WORKLOG_RPC: "submit_worklog_batch",

  /* 현재 Supabase에는 mold_master 테이블이 없어 동봉한 기준정보를 사용합니다. */
  MOLD_MASTER_SOURCE: "local",
  MOLD_MASTER_FILE: "./data/mold-master.json",
  MOLD_MASTER_TABLE: "mold_master",
  EMPLOYEE_MASTER_FILE: "./data/employee-master.json",

  REQUEST_TIMEOUT_MS: 15000,
  MAX_TASKS: 10,
  MAX_TOTAL_MINUTES: 1440
});
