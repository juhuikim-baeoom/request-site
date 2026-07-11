import { PagePlaceholder } from '../../components/PagePlaceholder'

export function ManageBoard() {
  return (
    <PagePlaceholder
      title="관리 보드"
      description="시스템팀이 전체 요청을 배정·진행 관리합니다. (화면 ③, system 전용)"
      todo={[
        '칸반 보드: 상태별 컬럼(접수/확인/진행중/검수대기/재작업/완료/보류/반려/이관)',
        '카드에서 상태 변경(드래그/드롭다운), 담당자 배정',
        '필터(기관/유형/담당자/우선순위/기한상태, 미배정만 보기)',
        '리스트 뷰 토글, 상세 패널(첨부·코멘트·이력·하위 연결)',
      ]}
    />
  )
}
