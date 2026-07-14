-- gen_seq() lpad 자릿수 잘림 수정.
-- PostgreSQL의 lpad(str, len, fill)은 str이 len보다 길면 "왼쪽 패딩"이 아니라 결과를
-- len 길이로 잘라낸다(오른쪽을 버림): select lpad('100', 2, '0') → '10'.
-- 0008이 갭 내성 채번(count(*)+1 → max(마지막 번호)+1)으로 고친 뒤에도, 어떤 날짜(KST)에
-- 99건이 쌓이면 100번째 접수는 n=100 → lpad(...)가 '10'으로 잘라 seq='YYMMDD-10' → 이미
-- 존재하는 10번 seq와 unique 충돌 → 500. 재시도해도 max(split_part(...))는 여전히 99이므로
-- n은 계속 100으로 계산돼 그 날짜가 끝날 때까지 접수가 전면 실패한다 — 0008이 막으려던 것과
-- 정확히 같은 자기영속형 장애다.
-- 100 이상부터는 자릿수가 자연스럽게 늘어나도록 고친다(2자리 미만만 0으로 패딩).
-- 동시 접수 직렬화(pg_advisory_xact_lock)는 문제 없었으므로 그대로 유지한다.
-- forward-only 원칙: 이미 적용된 0008을 편집하지 않고 create or replace로 새로 교체한다.
create or replace function gen_seq() returns trigger
language plpgsql as $$
declare d text := to_char(now() at time zone 'Asia/Seoul', 'YYMMDD'); n int;
begin
  if new.seq is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('req_seq_' || d));
  select coalesce(max(split_part(seq, '-', 2)::int), 0) + 1 into n
  from requests where seq like d || '-%';
  new.seq := d || '-' || case when n < 100 then lpad(n::text, 2, '0') else n::text end;
  return new;
end $$;
