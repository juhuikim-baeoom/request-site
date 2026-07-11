import { PagePlaceholder } from '../../components/PagePlaceholder'

export function RequestForm() {
  return (
    <PagePlaceholder
      title="요청 접수"
      description="직원이 업무요청을 구조화된 폼으로 제출합니다. (화면 ①)"
      todo={[
        '기관/유형/우선순위/공개범위 드롭다운',
        '제목·상세내용(다라라JS 에디터, HTML 저장)',
        '희망완료일 선택, 첨부파일 다중 업로드(Storage)',
        '제출 시 requests insert → 접수번호 자동 발급 → 내 요청으로 이동',
      ]}
    />
  )
}
