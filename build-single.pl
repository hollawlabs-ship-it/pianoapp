#!/usr/bin/perl
# index.html 이 참조하는 css/js 를 순서 그대로 한 파일에 인라인한다.
# 목적: 서버 설정 없이 URL 하나로 열어보는 테스트용 빌드.
# 원본은 건드리지 않는다. 순서는 index.html 에서 읽어오므로 여기서 관리하지 않는다.
use strict; use warnings;
local $/;

my $out = shift or die "usage: build-single.pl <출력경로>\n";
open(my $f, '<:raw', 'index.html') or die "index.html: $!";
my $html = <$f>; close $f;

my $slurp = sub {
  my ($p) = @_;
  open(my $h, '<:raw', $p) or die "$p: $!";
  my $t = <$h>; close $h;
  return $t;
};

# <head> / <body> 내용만 뽑는다 (아티팩트가 바깥 뼈대를 씌운다)
my ($head) = $html =~ m{<head>(.*?)</head>}s or die "no head\n";
my ($body) = $html =~ m{<body>(.*?)</body>}s or die "no body\n";

# 1) 스타일시트 인라인
my $css = '';
while ($head =~ m{<link\s+rel="stylesheet"\s+href="([^"]+)">}g) {
  my $p = $1;
  $css .= "\n/* ===== $p ===== */\n" . $slurp->($p);
}
die "no stylesheets found\n" unless $css;
$head =~ s{<link\s+rel="stylesheet"[^>]*>\s*}{}g;

# 2) manifest 제거 — 단일 파일에는 딸린 파일이 없다
$head =~ s{<link\s+rel="manifest"[^>]*>\s*}{}g;

# 3) 스크립트를 index.html 의 순서 그대로 인라인
my $js = '';
my $n = 0;
while ($body =~ m{<script\s+src="([^"]+)"></script>}g) {
  my $p = $1;
  $js .= "\n/* ===== $p ===== */\n" . $slurp->($p) . "\n;\n";
  $n++;
}
die "no scripts found\n" unless $n;
$body =~ s{<script\s+src="[^"]+"></script>\s*}{}g;

# 4) 서비스워커 등록 블록 제거 — sw.js 파일이 없어 404 만 난다
$body =~ s{<script>\s*//[^\n]*\n\s*if \('serviceWorker' in navigator.*?</script>}{}s;

my $banner = <<'BANNER';
<div class="build-note" role="note">
  <strong>테스트 빌드</strong> — 한 파일로 묶은 버전입니다.
  연습기록·구간별 표현·메트로놈·차트는 그대로 동작하고, 기록은 이 브라우저에 저장됩니다.
  <em>AI 레슨 분석 · 드롭박스 · 유튜브 역할모델</em>은 외부 접속이 막혀 동작하지 않습니다.
  <em>녹음</em>은 마이크 권한이 열리는지에 따라 갈립니다 — 막히면 녹음 대신
  <strong>파일 업로드</strong>로 음량 곡선 분석을 확인하세요.
  제대로 쓰려면 홈 화면에 설치되는 정식 주소를 쓰셔야 합니다.
</div>
BANNER

# 단일 테마(아이보리+에보니) 앱이라 뷰어 테마가 새어 들어오지 않게 못박는다
my $lock = <<'LOCK';

/* ===== 단일 파일 빌드 보정 ===== */
/* 이 앱은 아이보리+에보니 한 가지 톤으로 설계돼 있다.
   아티팩트는 뷰어 테마 위에 합성되므로 배경을 명시하지 않으면
   어두운 호스트 바탕이 비쳐 글자가 사라진다. 두 경우 모두 못박는다. */
:root, :root[data-theme="dark"], :root[data-theme="light"] { color-scheme: light; }
html, body { background: var(--paper); color: var(--ink); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: light; }
  html, body { background: var(--paper); color: var(--ink); }
}
.build-note {
  max-width: 560px; margin: 0 auto; padding: 12px 16px;
  border-bottom: 1px solid var(--paper-2);
  background: var(--surface-2); color: var(--ink-2);
  font-size: 13px; line-height: 1.6; word-break: keep-all;
}
.build-note strong { color: var(--ink); }
.build-note em { font-style: normal; text-decoration: underline; text-underline-offset: 2px; }
LOCK

open(my $o, '>:raw', $out) or die "$out: $!";
print $o $head;
print $o "<style>\n$css$lock\n</style>\n";
print $o $banner;
print $o $body;
print $o "<script>\n$js</script>\n";
close $o;

printf "빌드 완료: %s (%.0f KB, 스크립트 %d개)\n", $out, (-s $out)/1024, $n;
