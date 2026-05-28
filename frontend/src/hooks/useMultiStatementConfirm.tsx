/**
 * 멀티 statement 실행 중 오류 발생 시 계속/중단 선택을 toast.custom()으로 표시하는 헬퍼.
 * JSX가 필요해 .tsx 파일로 분리되었다.
 */
import toast from 'react-hot-toast'

/**
 * toast.custom()으로 계속/중단 선택 대화를 표시하고, 사용자 선택을 Promise로 반환한다.
 * @param failedIndex 실패한 statement 인덱스 (0-based)
 * @param totalCount  전체 statement 수
 * @param errorMsg    오류 메시지
 * @returns true = 계속 실행, false = 중단
 */
export function askContinueExecution(
  failedIndex: number,
  totalCount: number,
  errorMsg: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const remaining = totalCount - failedIndex - 1

    toast.custom(
      (t) => (
        <div
          style={{
            background: '#1e2230',
            border: '1px solid #fc8181',
            borderRadius: 8,
            padding: '12px 16px',
            minWidth: 340,
            maxWidth: 480,
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            fontFamily: 'inherit',
          }}
        >
          {/* 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ color: '#fc8181', fontSize: 14, fontWeight: 600 }}>
              ⚠ Statement {failedIndex + 1} 실패
            </span>
          </div>

          {/* 오류 메시지 */}
          <div
            style={{
              color: '#fc8181',
              fontSize: 11,
              background: '#2d1b1b',
              borderRadius: 4,
              padding: '6px 8px',
              marginBottom: 10,
              wordBreak: 'break-all',
              maxHeight: 80,
              overflow: 'auto',
              fontFamily: 'monospace',
            }}
          >
            {errorMsg}
          </div>

          {/* 안내 문구 */}
          <div style={{ color: '#a0aec0', fontSize: 12, marginBottom: 12 }}>
            나머지{' '}
            <strong style={{ color: '#e2e8f0' }}>{remaining}개</strong>의 statement를 계속
            실행할까요?
          </div>

          {/* 버튼 */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                toast.dismiss(t.id)
                resolve(false)
              }}
              style={{
                padding: '5px 14px',
                borderRadius: 5,
                border: '1px solid #4a5568',
                background: 'transparent',
                color: '#a0aec0',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              중단
            </button>
            <button
              onClick={() => {
                toast.dismiss(t.id)
                resolve(true)
              }}
              style={{
                padding: '5px 14px',
                borderRadius: 5,
                border: 'none',
                background: '#4299e1',
                color: '#fff',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              계속 실행
            </button>
          </div>
        </div>
      ),
      { duration: Infinity, id: `multi-err-${failedIndex}` },
    )
  })
}
