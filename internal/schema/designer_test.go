package schema

// designer_test.go — DDL 생성 함수 단위 테스트.
//
// DB 연결이 필요 없는 순수 함수 + Designer 메서드(GenerateAlterSQL/GenerateCreateSQL) 만 다룬다.
// BuildAlterFromMeta / GetTableDefinition / GetTableMeta 는 sqlmock 기반 통합 테스트가 필요해 후속 과제.

import (
	"strings"
	"testing"
)

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

func TestEscapeIdent(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", ""},
		{"users", "users"},
		{"weird`name", "weird``name"},
		{"a`b`c", "a``b``c"},
		{"`leading_trailing`", "``leading_trailing``"},
	}
	for _, tc := range cases {
		if got := escapeIdent(tc.in); got != tc.want {
			t.Errorf("escapeIdent(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestQuoteIdent(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", "``"},
		{"users", "`users`"},
		{"weird`name", "`weird``name`"},
		// 식별자에 공백/한글/이모지 포함 — backtick 만 escape 하면 됨 (MySQL 은 다른 문자 그대로 허용)
		{"한글 테이블", "`한글 테이블`"},
	}
	for _, tc := range cases {
		if got := quoteIdent(tc.in); got != tc.want {
			t.Errorf("quoteIdent(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestColumnDDL_BackticksInName(t *testing.T) {
	// BugFix-BY: 식별자 안의 backtick 은 두 번 반복으로 escape 되어야 함.
	col := ColumnDef{Name: "weird`col", DataType: "int", NotNull: true}
	want := "`weird``col` int NOT NULL"
	if got := columnDDL(col); got != want {
		t.Errorf("columnDDL\n  got:  %s\n  want: %s", got, want)
	}
}

func TestIndexDDL_BackticksInColumnName(t *testing.T) {
	idx := IndexDef{Name: "i`x", Columns: []string{"a`b"}}
	want := "INDEX `i``x` (`a``b`)"
	if got := indexDDL(idx); got != want {
		t.Errorf("indexDDL\n  got:  %s\n  want: %s", got, want)
	}
}

func TestFkDDL_BackticksInName(t *testing.T) {
	fk := ForeignKeyDef{Name: "fk`x", Column: "u`id", RefTable: "u`s", RefColumn: "i`d", OnDelete: "CASCADE", OnUpdate: "RESTRICT"}
	want := "CONSTRAINT `fk``x` FOREIGN KEY (`u``id`) REFERENCES `u``s` (`i``d`) ON DELETE CASCADE ON UPDATE RESTRICT"
	if got := fkDDL(fk); got != want {
		t.Errorf("fkDDL\n  got:  %s\n  want: %s", got, want)
	}
}

func TestEscapeSQLString(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", ""},
		{"hello", "hello"},
		{"O'Brien", "O''Brien"},
		{"a''b", "a''''b"},
	}
	for _, tc := range cases {
		if got := escapeSQLString(tc.in); got != tc.want {
			t.Errorf("escapeSQLString(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestExtractLength(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"int", ""},
		{"varchar(255)", "255"},
		{"decimal(10,2)", "10,2"},
		{"text", ""},
		{"enum('a','b')", "'a','b'"},
	}
	for _, tc := range cases {
		if got := extractLength(tc.in); got != tc.want {
			t.Errorf("extractLength(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestIsDefaultLiteral(t *testing.T) {
	literals := []string{"NULL", "null", "  CURRENT_TIMESTAMP  ", "current_timestamp()", "CURRENT_TIMESTAMP(6)", "(JSON_OBJECT())"}
	for _, s := range literals {
		if !isDefaultLiteral(s) {
			t.Errorf("isDefaultLiteral(%q) = false, want true", s)
		}
	}
	quoted := []string{"hello", "0", "1.5", "abc'def"}
	for _, s := range quoted {
		if isDefaultLiteral(s) {
			t.Errorf("isDefaultLiteral(%q) = true, want false", s)
		}
	}
}

func TestBracketCols(t *testing.T) {
	if got := bracketCols([]string{"a", "b"}); got != "`a`, `b`" {
		t.Errorf("bracketCols = %q", got)
	}
	if got := bracketCols(nil); got != "" {
		t.Errorf("bracketCols(nil) = %q, want empty", got)
	}
}

func TestColumnDDL(t *testing.T) {
	cases := []struct {
		name string
		col  ColumnDef
		want string
	}{
		{
			name: "simple int NOT NULL",
			col:  ColumnDef{Name: "id", DataType: "int", NotNull: true},
			want: "`id` int NOT NULL",
		},
		{
			name: "varchar with length and default",
			col:  ColumnDef{Name: "name", DataType: "varchar", Length: "255", NotNull: true, Default: "hello"},
			want: "`name` varchar(255) NOT NULL DEFAULT 'hello'",
		},
		{
			name: "auto increment unsigned",
			col:  ColumnDef{Name: "id", DataType: "bigint", NotNull: true, Unsigned: true, AutoInc: true},
			want: "`id` bigint UNSIGNED NOT NULL AUTO_INCREMENT",
		},
		{
			name: "default literal NULL not quoted",
			col:  ColumnDef{Name: "deleted_at", DataType: "datetime", Default: "NULL"},
			want: "`deleted_at` datetime NULL DEFAULT NULL",
		},
		{
			name: "BugFix-G: NOT NULL + DEFAULT NULL → DEFAULT 절 생략",
			col:  ColumnDef{Name: "x", DataType: "int", NotNull: true, Default: "NULL"},
			want: "`x` int NOT NULL",
		},
		{
			name: "default literal CURRENT_TIMESTAMP not quoted",
			col:  ColumnDef{Name: "created_at", DataType: "timestamp", NotNull: true, Default: "CURRENT_TIMESTAMP"},
			want: "`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP",
		},
		{
			name: "ON UPDATE",
			col:  ColumnDef{Name: "updated_at", DataType: "timestamp", NotNull: true, Default: "CURRENT_TIMESTAMP", OnUpdate: "CURRENT_TIMESTAMP"},
			want: "`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
		},
		{
			name: "comment with quote escaped",
			col:  ColumnDef{Name: "note", DataType: "text", Comment: "Bob's note"},
			want: "`note` text NULL COMMENT 'Bob''s note'",
		},
		{
			name: "default value with quote escaped",
			col:  ColumnDef{Name: "tag", DataType: "varchar", Length: "50", Default: "O'Brien"},
			want: "`tag` varchar(50) NULL DEFAULT 'O''Brien'",
		},
		{
			name: "decimal with composite length",
			col:  ColumnDef{Name: "price", DataType: "decimal", Length: "10,2", NotNull: true},
			want: "`price` decimal(10,2) NOT NULL",
		},
		{
			name: "ZEROFILL flag",
			col:  ColumnDef{Name: "n", DataType: "int", Length: "5", Unsigned: true, ZeroFill: true, NotNull: true},
			want: "`n` int(5) UNSIGNED ZEROFILL NOT NULL",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := columnDDL(tc.col); got != tc.want {
				t.Errorf("columnDDL\n  got:  %s\n  want: %s", got, tc.want)
			}
		})
	}
}

func TestIndexDDL(t *testing.T) {
	cases := []struct {
		name string
		idx  IndexDef
		want string
	}{
		{
			name: "regular single column",
			idx:  IndexDef{Name: "idx_name", Columns: []string{"name"}},
			want: "INDEX `idx_name` (`name`)",
		},
		{
			name: "unique multi column",
			idx:  IndexDef{Name: "uq_a_b", Columns: []string{"a", "b"}, Unique: true},
			want: "UNIQUE INDEX `uq_a_b` (`a`, `b`)",
		},
		{
			name: "fulltext",
			idx:  IndexDef{Name: "ft", Columns: []string{"body"}, FullText: true},
			want: "FULLTEXT INDEX `ft` (`body`)",
		},
		{
			name: "DESC direction",
			idx:  IndexDef{Name: "i", Columns: []string{"a", "b"}, ColumnDirections: []string{"ASC", "DESC"}},
			want: "INDEX `i` (`a`, `b` DESC)",
		},
		{
			name: "all DESC",
			idx:  IndexDef{Name: "i", Columns: []string{"a", "b"}, ColumnDirections: []string{"DESC", "DESC"}, Unique: true},
			want: "UNIQUE INDEX `i` (`a` DESC, `b` DESC)",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := indexDDL(tc.idx); got != tc.want {
				t.Errorf("indexDDL\n  got:  %s\n  want: %s", got, tc.want)
			}
		})
	}
}

func TestFkDDL(t *testing.T) {
	fk := ForeignKeyDef{
		Name:      "fk_user",
		Column:    "user_id",
		RefTable:  "users",
		RefColumn: "id",
		OnDelete:  "CASCADE",
		OnUpdate:  "RESTRICT",
	}
	want := "CONSTRAINT `fk_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT"
	if got := fkDDL(fk); got != want {
		t.Errorf("fkDDL\n  got:  %s\n  want: %s", got, want)
	}
}

func TestColumnChanged(t *testing.T) {
	base := ColumnDef{Name: "x", DataType: "int", Length: "11", NotNull: true, Default: "0", AutoInc: false, Unsigned: false, ZeroFill: false, Comment: "", OnUpdate: ""}

	if columnChanged(base, base) {
		t.Errorf("identical columns reported changed")
	}
	mut := base
	mut.DataType = "bigint"
	if !columnChanged(base, mut) {
		t.Errorf("DataType change not detected")
	}
	mut = base
	mut.NotNull = false
	if !columnChanged(base, mut) {
		t.Errorf("NotNull change not detected")
	}
	mut = base
	mut.Comment = "new"
	if !columnChanged(base, mut) {
		t.Errorf("Comment change not detected")
	}
	mut = base
	mut.OnUpdate = "CURRENT_TIMESTAMP"
	if !columnChanged(base, mut) {
		t.Errorf("OnUpdate change not detected")
	}

	// Name 변경은 columnChanged 가 감지 대상이 아님 (rename 은 별도 경로)
	mut = base
	mut.Name = "y"
	if columnChanged(base, mut) {
		t.Errorf("Name change should not be reported (rename is a separate path)")
	}
}

func TestSameIndexColumns(t *testing.T) {
	a := IndexDef{Columns: []string{"x", "y"}, ColumnDirections: []string{"ASC", "DESC"}}
	b := IndexDef{Columns: []string{"x", "y"}, ColumnDirections: []string{"ASC", "DESC"}}
	if !sameIndexColumns(a, b) {
		t.Errorf("identical indexes reported different")
	}

	// 길이 다름
	c := IndexDef{Columns: []string{"x"}}
	if sameIndexColumns(a, c) {
		t.Errorf("differing column count not detected")
	}

	// 컬럼명 다름
	d := IndexDef{Columns: []string{"x", "z"}, ColumnDirections: []string{"ASC", "DESC"}}
	if sameIndexColumns(a, d) {
		t.Errorf("differing column name not detected")
	}

	// 방향 다름
	e := IndexDef{Columns: []string{"x", "y"}, ColumnDirections: []string{"ASC", "ASC"}}
	if sameIndexColumns(a, e) {
		t.Errorf("differing direction not detected")
	}

	// 빈 ColumnDirections 는 ASC 로 간주
	f := IndexDef{Columns: []string{"x", "y"}}
	g := IndexDef{Columns: []string{"x", "y"}, ColumnDirections: []string{"ASC", "ASC"}}
	if !sameIndexColumns(f, g) {
		t.Errorf("empty directions should equal explicit ASC")
	}
}

// ─── GenerateAlterSQL ────────────────────────────────────────────────────────

func TestGenerateAlterSQL_NoChange(t *testing.T) {
	d := &Designer{}
	tbl := &TableDefinition{
		Name:    "t",
		Columns: []ColumnDef{{Name: "id", DataType: "int", NotNull: true}},
	}
	got, err := d.GenerateAlterSQL("db", "t", tbl, tbl)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got.SQL != "" || got.Preview != "변경 없음" {
		t.Errorf("expected empty SQL + '변경 없음', got SQL=%q, Preview=%q", got.SQL, got.Preview)
	}
}

func TestGenerateAlterSQL_AddColumn(t *testing.T) {
	d := &Designer{}
	old := &TableDefinition{Name: "t", Columns: []ColumnDef{{Name: "id", DataType: "int", NotNull: true}}}
	new := &TableDefinition{Name: "t", Columns: []ColumnDef{
		{Name: "id", DataType: "int", NotNull: true},
		{Name: "name", DataType: "varchar", Length: "255"},
	}}
	got, err := d.GenerateAlterSQL("db", "t", old, new)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !strings.Contains(got.SQL, "ADD COLUMN `name` varchar(255) NULL") {
		t.Errorf("missing ADD COLUMN clause:\n%s", got.SQL)
	}
	if !strings.Contains(got.SQL, "ALTER TABLE `db`.`t`") {
		t.Errorf("missing ALTER TABLE prefix:\n%s", got.SQL)
	}
}

func TestGenerateAlterSQL_DropColumn(t *testing.T) {
	d := &Designer{}
	old := &TableDefinition{Name: "t", Columns: []ColumnDef{
		{Name: "id", DataType: "int", NotNull: true},
		{Name: "old_col", DataType: "text"},
	}}
	new := &TableDefinition{Name: "t", Columns: []ColumnDef{
		{Name: "id", DataType: "int", NotNull: true},
	}}
	got, err := d.GenerateAlterSQL("db", "t", old, new)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !strings.Contains(got.SQL, "DROP COLUMN `old_col`") {
		t.Errorf("missing DROP COLUMN:\n%s", got.SQL)
	}
}

func TestGenerateAlterSQL_ModifyColumn(t *testing.T) {
	d := &Designer{}
	old := &TableDefinition{Name: "t", Columns: []ColumnDef{
		{Name: "amount", DataType: "int", NotNull: true},
	}}
	new := &TableDefinition{Name: "t", Columns: []ColumnDef{
		{Name: "amount", DataType: "bigint", NotNull: true},
	}}
	got, err := d.GenerateAlterSQL("db", "t", old, new)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !strings.Contains(got.SQL, "MODIFY COLUMN `amount` bigint NOT NULL") {
		t.Errorf("missing MODIFY COLUMN:\n%s", got.SQL)
	}
}

func TestGenerateAlterSQL_IndexAddDrop(t *testing.T) {
	d := &Designer{}
	old := &TableDefinition{Name: "t", Indexes: []IndexDef{
		{Name: "old_idx", Columns: []string{"a"}},
	}}
	new := &TableDefinition{Name: "t", Indexes: []IndexDef{
		{Name: "new_idx", Columns: []string{"b"}, Unique: true},
	}}
	got, err := d.GenerateAlterSQL("db", "t", old, new)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !strings.Contains(got.SQL, "DROP INDEX `old_idx`") {
		t.Errorf("missing DROP INDEX:\n%s", got.SQL)
	}
	if !strings.Contains(got.SQL, "ADD UNIQUE INDEX `new_idx` (`b`)") {
		t.Errorf("missing ADD UNIQUE INDEX:\n%s", got.SQL)
	}
}

func TestGenerateAlterSQL_PrimaryKeyIgnored(t *testing.T) {
	// PK 변경은 GenerateAlterSQL 의 인덱스 비교에서 제외(주석 라인 434, 443)
	d := &Designer{}
	old := &TableDefinition{Name: "t", Indexes: []IndexDef{
		{Name: "PRIMARY", Columns: []string{"id"}, IsPrimary: true},
	}}
	new := &TableDefinition{Name: "t", Indexes: []IndexDef{}}
	got, err := d.GenerateAlterSQL("db", "t", old, new)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got.SQL != "" {
		t.Errorf("PK index removal should not generate ALTER (PK는 별도 처리), got: %q", got.SQL)
	}
}

func TestGenerateAlterSQL_FKAddDrop(t *testing.T) {
	d := &Designer{}
	old := &TableDefinition{Name: "t", ForeignKeys: []ForeignKeyDef{
		{Name: "fk_old", Column: "x", RefTable: "u", RefColumn: "id", OnDelete: "CASCADE", OnUpdate: "RESTRICT"},
	}}
	new := &TableDefinition{Name: "t", ForeignKeys: []ForeignKeyDef{
		{Name: "fk_new", Column: "y", RefTable: "v", RefColumn: "id", OnDelete: "SET NULL", OnUpdate: "NO ACTION"},
	}}
	got, err := d.GenerateAlterSQL("db", "t", old, new)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !strings.Contains(got.SQL, "DROP FOREIGN KEY `fk_old`") {
		t.Errorf("missing DROP FK:\n%s", got.SQL)
	}
	if !strings.Contains(got.SQL, "ADD CONSTRAINT `fk_new` FOREIGN KEY (`y`) REFERENCES `v` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION") {
		t.Errorf("missing ADD FK:\n%s", got.SQL)
	}
}

func TestGenerateAlterSQL_TableOptions(t *testing.T) {
	d := &Designer{}
	old := &TableDefinition{Name: "t", Engine: "MyISAM", Comment: "old"}
	new := &TableDefinition{Name: "t", Engine: "InnoDB", Comment: "new with O'Brien"}
	got, err := d.GenerateAlterSQL("db", "t", old, new)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !strings.Contains(got.SQL, "ENGINE = InnoDB") {
		t.Errorf("missing ENGINE change:\n%s", got.SQL)
	}
	if !strings.Contains(got.SQL, "COMMENT = 'new with O''Brien'") {
		t.Errorf("missing or unescaped COMMENT change:\n%s", got.SQL)
	}
}

// ─── GenerateCreateSQL ───────────────────────────────────────────────────────

func TestGenerateCreateSQL_RequiresName(t *testing.T) {
	d := &Designer{}
	_, err := d.GenerateCreateSQL("db", &TableDefinition{
		Columns: []ColumnDef{{Name: "id", DataType: "int"}},
	})
	if err == nil {
		t.Errorf("expected error for missing table name")
	}
}

func TestGenerateCreateSQL_RequiresColumn(t *testing.T) {
	d := &Designer{}
	_, err := d.GenerateCreateSQL("db", &TableDefinition{Name: "t"})
	if err == nil {
		t.Errorf("expected error for empty columns")
	}
}

func TestGenerateCreateSQL_NilDef(t *testing.T) {
	d := &Designer{}
	if _, err := d.GenerateCreateSQL("db", nil); err == nil {
		t.Errorf("expected error for nil def")
	}
}

func TestGenerateCreateSQL_Basic(t *testing.T) {
	d := &Designer{}
	def := &TableDefinition{
		Name:    "users",
		Engine:  "InnoDB",
		Charset: "utf8mb4",
		Columns: []ColumnDef{
			{Name: "id", DataType: "bigint", NotNull: true, Unsigned: true, AutoInc: true, PrimaryKey: true},
			{Name: "email", DataType: "varchar", Length: "255", NotNull: true},
		},
	}
	got, err := d.GenerateCreateSQL("db", def)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !strings.Contains(got.SQL, "CREATE TABLE `db`.`users`") {
		t.Errorf("missing CREATE TABLE prefix:\n%s", got.SQL)
	}
	if !strings.Contains(got.SQL, "PRIMARY KEY (`id`)") {
		t.Errorf("missing PRIMARY KEY clause:\n%s", got.SQL)
	}
	if !strings.Contains(got.SQL, "ENGINE=InnoDB") {
		t.Errorf("missing ENGINE clause:\n%s", got.SQL)
	}
	if !strings.Contains(got.SQL, "DEFAULT CHARSET=utf8mb4") {
		t.Errorf("missing CHARSET clause:\n%s", got.SQL)
	}
	if !strings.HasSuffix(got.SQL, ";") {
		t.Errorf("SQL should end with semicolon")
	}
}

func TestGenerateCreateSQL_CompositePK(t *testing.T) {
	d := &Designer{}
	def := &TableDefinition{
		Name: "join_t",
		Columns: []ColumnDef{
			{Name: "a_id", DataType: "int", NotNull: true, PrimaryKey: true},
			{Name: "b_id", DataType: "int", NotNull: true, PrimaryKey: true},
		},
	}
	got, err := d.GenerateCreateSQL("db", def)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !strings.Contains(got.SQL, "PRIMARY KEY (`a_id`, `b_id`)") {
		t.Errorf("composite PK not generated:\n%s", got.SQL)
	}
}

func TestGenerateCreateSQL_WithIndexAndFK(t *testing.T) {
	d := &Designer{}
	def := &TableDefinition{
		Name: "orders",
		Columns: []ColumnDef{
			{Name: "id", DataType: "int", NotNull: true, PrimaryKey: true},
			{Name: "user_id", DataType: "int", NotNull: true},
		},
		Indexes: []IndexDef{
			{Name: "PRIMARY", Columns: []string{"id"}, IsPrimary: true},
			{Name: "idx_user", Columns: []string{"user_id"}},
		},
		ForeignKeys: []ForeignKeyDef{
			{Name: "fk_user", Column: "user_id", RefTable: "users", RefColumn: "id", OnDelete: "CASCADE", OnUpdate: "CASCADE"},
		},
	}
	got, err := d.GenerateCreateSQL("db", def)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if strings.Contains(got.SQL, "PRIMARY") && strings.Count(got.SQL, "PRIMARY KEY") > 1 {
		// PRIMARY 인덱스는 PK 라인으로 처리되며 indexDDL 로 한 번 더 출력되면 안 됨
		t.Errorf("PRIMARY index emitted twice:\n%s", got.SQL)
	}
	if !strings.Contains(got.SQL, "INDEX `idx_user` (`user_id`)") {
		t.Errorf("missing regular index:\n%s", got.SQL)
	}
	if !strings.Contains(got.SQL, "CONSTRAINT `fk_user`") {
		t.Errorf("missing FK constraint:\n%s", got.SQL)
	}
}

func TestGenerateCreateSQL_PreviewIncludesColumnCount(t *testing.T) {
	d := &Designer{}
	def := &TableDefinition{
		Name:    "t",
		Columns: []ColumnDef{{Name: "a", DataType: "int"}, {Name: "b", DataType: "int"}, {Name: "c", DataType: "int"}},
	}
	got, _ := d.GenerateCreateSQL("db", def)
	if !strings.Contains(got.Preview, "(3 columns)") {
		t.Errorf("preview should mention column count, got: %q", got.Preview)
	}
}
