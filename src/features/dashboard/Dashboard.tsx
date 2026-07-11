import { PagePlaceholder } from '../../components/PagePlaceholder'

export function Dashboard() {
  return (
    <PagePlaceholder
      title="통계 대시보드"
      description="접수·처리 현황과 지표를 확인합니다. (화면 ④, system·viewer)"
      todo={[
        'KPI: 전체/미완료/기한초과+지연/긴급 미완료/재작업/이관 건수',
        '평균 1차·최종 리드타임(request_view 기반)',
        '상태별·기관별·유형별 집계, 기한상태별 분포',
        '월별 추이(접수/완료), 담당자별 처리 현황, 기간 필터',
      ]}
    />
  )
}
