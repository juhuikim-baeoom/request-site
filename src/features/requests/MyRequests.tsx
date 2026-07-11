import { PagePlaceholder } from '../../components/PagePlaceholder'

export function MyRequests() {
  return (
    <PagePlaceholder
      title="내 요청 목록"
      description="본인 및 공개범위상 볼 수 있는 요청의 진행 상황을 확인합니다. (화면 ②)"
      todo={[
        '목록: 접수번호·제목·기관·유형·상태·담당자·희망완료일·기한상태',
        '필터(상태/유형/기관), 탭(내 요청 / 부서·공유 요청)',
        '정렬(최신 기본, 기한상태 우선 옵션), 상태·기한 배지',
        '상세 보기(모달/페이지): 내용·첨부·이력·코멘트',
      ]}
    />
  )
}
