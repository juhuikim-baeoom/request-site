-- 역할 모델 정교화: 기존 사용자 이전.
--  ① viewer → exec (전체 열람 + 통계, 쓰기 없음 — 성격이 동일)
--  ② juhuikim@baeoom.com → system_admin (유일한 초기 관리자)
-- 나머지 system 사용자는 '시스템팀 담당자'로 그대로 둔다.
-- 이후 역할 변경은 계정 관리 화면에서 한다.

update users set role = 'exec' where role = 'viewer';
update org_directory set role = 'exec' where role = 'viewer';

update users set role = 'system_admin' where email = 'juhuikim@baeoom.com';
update org_directory set role = 'system_admin' where email = 'juhuikim@baeoom.com';
