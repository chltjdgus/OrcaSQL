package main

// ─── SQL 식별자 이스케이프 (BugFix-DQ) ─────────────────────────────────────
//
// app 레벨 핸들러(app_table_ops.go / app_query.go / app_data_search.go)가 DB·테이블·컬럼·
// 신규이름을 backtick 으로 감쌀 때 사용하는 공용 헬퍼.
//
// 배경: 이전 식별자 보강(BugFix-BY/CC)은 internal/{schema,sync,inspector,backup} 만 다뤘고
// app 레벨 핸들러는 누락되어 있었다. 그 결과 RenameTable/CopyTable/CreateDatabase 등
// 사용자 자유입력 식별자가 escape 없이 보간돼 (1) backtick 포함 식별자(MySQL 합법) 시 깨진
// SQL, (2) 식별자 인젝션 가능성이 남아 있었다. internal/* 의 동명 헬퍼와 동일 정책으로 보강한다.
// (패키지 경계상 internal 헬퍼를 직접 import 하기 곤란해 의도적으로 복제 — 동작 차이는 회귀 테스트로 잡힘.)

import "strings"

// escapeIdent MySQL identifier 안의 backtick 을 두 번 반복으로 escape 한다.
func escapeIdent(s string) string {
	return strings.ReplaceAll(s, "`", "``")
}

// quoteIdent 식별자를 backtick 으로 감싼 안전한 형태로 반환한다.
// SELECT/UPDATE/INSERT/DDL 의 DB·테이블·컬럼명 보간에 사용해 식별자 인젝션·깨진 SQL 을 막는다.
func quoteIdent(s string) string {
	return "`" + escapeIdent(s) + "`"
}
