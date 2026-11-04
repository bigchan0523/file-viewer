# 파일 뷰어

광고 없는 안드로이드용 PDF · HWP · HWPX · 엑셀(xlsx/xls/csv) · TXT 뷰어.

- 파일 앱·카톡에서 **다른 앱으로 열기 → 파일 뷰어** 또는 **공유하기 → 파일 뷰어**
- 앱 안에서 **파일 열기**, **최근 파일** 목록
- 두 손가락으로 확대/축소, 상단에 쪽 번호 표시, 원본 공유
- PDF·한글 서류 채우기 (연필 버튼 → 글자/체크/서명 → 새 PDF로 저장)
- 문서는 폰 안에서만 그려지고, 앱은 인터넷 요청을 전부 막음

## 설치

[Releases](../../releases/latest) 에서 최신 `file-viewer-*.apk` 를 폰으로 받아 설치.

## 구조

| 부분 | 내용 |
|---|---|
| `app/src/main/java/.../MainActivity.kt` | WebView 껍데기, 파일 열기 인텐트, 최근 파일 |
| `app/src/main/assets/viewer.html`, `app.js` | 화면과 렌더링 |
| `scripts/fetch-libs.sh` | 빌드할 때 npm에서 pdf.js, rhwp 를 받아 `assets/vendor` 에 넣음 |
| `.github/workflows/build.yml` | main 에 push 하면 APK 빌드 후 Release 에 올림 |

## 사용한 오픈소스

- [pdf.js](https://github.com/mozilla/pdf.js) — Apache-2.0
- [rhwp](https://github.com/edwardkim/rhwp) — MIT
- [SheetJS](https://sheetjs.com) — Apache-2.0
- [pdf-lib](https://github.com/Hopding/pdf-lib) — MIT
