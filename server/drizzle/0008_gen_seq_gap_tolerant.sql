-- gen_seq() 갭 내성 채번으로 교체.
-- 기존 count(*)+1 방식은 중간 행이 삭제돼 그 날짜의 seq 번호열에 갭이 생기면
-- 이미 존재하는 seq와 충돌(unique violation)해 POST /api/requests가 500이 되고,
-- 재시도해도 같은 숫자를 다시 계산하므로 그 날짜(KST 기준)가 끝날 때까지 접수가 계속 실패한다.
-- max(마지막 번호)+1로 바꾸면 갭이 있어도 항상 실제 마지막 번호 다음을 채번한다.
-- 동시 접수 직렬화(pg_advisory_xact_lock)는 문제 없었으므로 그대로 유지한다.
-- forward-only 원칙: 0001에서 만든 함수를 create or replace로 교체한다(이미 적용된 파일 편집 금지).
create or replace function gen_seq() returns trigger
language plpgsql as $$
declare d text := to_char(now() at time zone 'Asia/Seoul', 'YYMMDD'); n int;
begin
  if new.seq is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('req_seq_' || d));
  select coalesce(max(split_part(seq, '-', 2)::int), 0) + 1 into n
  from requests where seq like d || '-%';
  new.seq := d || '-' || lpad(n::text, 2, '0');
  return new;
end $$;
