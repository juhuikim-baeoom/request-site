import { PagePlaceholder } from '../../components/PagePlaceholder'

export function Accounts() {
  return (
    <PagePlaceholder
      title="계정 관리"
      description="직원 계정의 역할·부서·소속기관을 관리합니다. (화면 ⑤, system 전용)"
      todo={[
        '직원 목록(profiles): 이름·이메일·부서·소속기관·역할',
        '수정: 역할(staff/system/viewer)·부서·소속기관',
        '최초 인원 일괄 입력(CSV import 또는 순차 입력)',
        '부서·기관 변경은 이후 신규 요청부터 반영(과거 스냅샷 유지) 안내',
      ]}
    />
  )
}
