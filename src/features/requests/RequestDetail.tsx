import { useParams } from 'react-router-dom'
import { PagePlaceholder } from '../../components/PagePlaceholder'

export function RequestDetail() {
  const { id } = useParams<{ id: string }>()

  return (
    <PagePlaceholder
      title={`요청 상세 #${id ?? ''}`}
      description="요청 내용·첨부·상태 변경 이력·코멘트 스레드를 확인합니다. (화면 ②-상세)"
      todo={[
        '요청 내용(에디터 렌더), 첨부 다운로드',
        '상태 변경 이력(status_history), 코멘트 스레드/작성',
        "본인 요청이 '접수' 상태이면 수정·취소 가능",
        '처리 시작 이후엔 코멘트로만 소통',
      ]}
    />
  )
}
