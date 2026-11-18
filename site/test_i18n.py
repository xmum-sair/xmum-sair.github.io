"""Checks for site/i18n.py and the language switch. Run from the repo root: python -m pytest site/test_i18n.py"""
import pathlib
import re
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).parent))
ROOT = pathlib.Path(__file__).resolve().parents[1]
import build
import i18n

ZH, SEP, EN = '<span class="l-zh">', '<span class="l-sep">', '<span class="l-en">'


def loc(body: str) -> str:
    return i18n.localize(f"<body>{body}</body>")[6:-7]


def test_plain_pairs_are_marked():
    assert loc("<h1>讨论区 | Discussion</h1>") == f"<h1>{ZH}讨论区</span>{SEP} | </span>{EN}Discussion</span></h1>"
    assert loc("<th>学期 / Session</th>") == f"<th>{ZH}学期</span>{SEP} / </span>{EN}Session</span></th>"
    assert loc("<th>昵称/Name</th>") == f"<th>{ZH}昵称</span>{SEP}/</span>{EN}Name</span></th>"
    # a line break between the halves, the English in its own small print
    assert loc("<li>拖文件就行。<br><small>Just drop your files.</small></li>") == \
        f'<li>{ZH}拖文件就行。</span><br class="l-sep">{EN}<small>Just drop your files.</small></span></li>'
    assert loc("<h2>新机会 <small>New opportunities</small></h2>") == \
        f'<h2>{ZH}新机会</span>{SEP} </span><small class="l-en">New opportunities</small></h2>'
    # one paragraph, both languages
    assert loc("<p>习题仅保留题目。Tutorials contain questions only.</p>") == \
        f"<p>{ZH}习题仅保留题目。</span>{EN}Tutorials contain questions only.</span></p>"


def test_what_both_halves_share_stays_outside():
    assert loc("<p>🧭 机会墙 | All opportunities →</p>") == f"<p>🧭 {ZH}机会墙</span>{SEP} | </span>{EN}All opportunities</span> →</p>"
    assert loc("<label>课程代码 | Course code *</label>") == f"<label>{ZH}课程代码</span>{SEP} | </span>{EN}Course code</span> *</label>"
    assert loc("<p>网页版 | Website: https://example.org/</p>") == \
        f"<p>{ZH}网页版</span>{SEP} | </span>{EN}Website</span>: https://example.org/</p>"
    # a label in two languages in front of a value both share
    assert loc('<p>老师 | Lecturer: <a href="/l/x/">X</a></p>') == \
        f'<p>{ZH}老师</span>{SEP} | </span>{EN}Lecturer</span>: <a href="/l/x/">X</a></p>'
    # several pairs on one line, each on its own
    out = loc('<p><a href="/a/">免责声明 | Disclaimer</a> · <a href="/b/">联系 | Contact</a></p>')
    assert out.count(ZH) == 2 and f'<a href="/a/">{ZH}免责声明</span>' in out


def test_nothing_is_hidden_unless_the_halves_say_the_same():
    """A half that would take a link, a number or an address with it when hidden is not a half: the text stays as written."""
    for body in ('<p>修课学期 | Taken in: 2025-04</p>',                                       # the session is not in the Chinese
                 "<p>被 3 个人举报后隐藏。<br>Hidden after three reports.</p>",                 # 3 against "three"
                 "<p>参考 COM203<br>See the 2024 paper</p>",
                 "<p>写信到 a@b.org | Email us</p>",
                 "<p>Past papers / 真题</p>",                                                 # English first: not this site's order
                 "<p>中文 | 还是中文</p>"):
        assert loc(body) == body, body


def test_course_names_and_marked_text_are_left_alone():
    assert loc("<h1>COM213 Computer Architecture</h1>") == "<h1>COM213 Computer Architecture</h1>"
    assert loc('<td><a href="/EEE/COM107_Circuits_and_Devices/">Circuits and Devices</a></td>').count("l-") == 0
    kept = '<p data-nt>面试 | interview tips</p><code>中文 | English</code><script>var s = "中文 | English";</script>'
    assert loc(kept) == kept
    by_hand = f"<p>3 {build.bi('份', 'files')} · {build.bi('来自', 'by')} Joyce</p>"
    assert loc(by_hand) == by_hand
    assert i18n.plain(by_hand) == "<p>3 份 | files · 来自 | by Joyce</p>"


def test_paragraph_and_list_pairs():
    out = loc("<p>欢迎来到厦马。</p>\n<p>Welcome to XMUM.</p>")
    assert out == '<p class="l-zh">欢迎来到厦马。</p>\n<p class="l-en">Welcome to XMUM.</p>'
    out = loc("<p>这里的一切都免费。</p>\n<p>Everything here is free.</p><p>COM203 Computer Architecture</p>")
    assert out == '<p class="l-zh">这里的一切都免费。</p>\n<p class="l-en">Everything here is free.</p><p>COM203 Computer Architecture</p>'
    out = loc("<ul><li>免费</li><li>公开</li><li>Free</li><li>Open</li></ul>")
    assert out == '<ul><li class="l-zh">免费</li><li class="l-zh">公开</li><li class="l-en">Free</li><li class="l-en">Open</li></ul>'
    assert loc("<ul><li>免费</li><li>Free</li><li>公开</li></ul>").count("l-") == 0


def test_marks_only_add_markup():
    """Reading the marks away gives back the page as it was written, for every page of the real site."""
    out = pathlib.Path(tempfile.mkdtemp()) / "_site"
    site = build.build(ROOT, out, "/")
    seen = 0
    for page in out.rglob("*.html"):
        raw = page.read_text(encoding="utf-8")
        if build.REDIRECT_MARK in raw:
            assert "l-zh" not in raw
            continue
        seen += 1
        text = lambda h: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", h))   # noqa: E731
        assert text(i18n.plain(raw)) == text(raw), page
        assert 'class="lang-toggle"' in raw and "localStorage.getItem('lang')" in raw and "navigator.language" in raw, page
        assert "/^zh/i.test(" in raw and "d.setAttribute('data-lang',l)" in raw, page   # Chinese systems get Chinese, the rest English
        assert f'XMUM SAIR {ZH}生存指南</span>' in raw, page
    assert seen > len(site.courses)
    qa = (out / "qa/index.html").read_text(encoding="utf-8")
    assert f"<h1>{ZH}讨论区</span>{SEP} | </span>{EN}Discussion</span></h1>" in qa
    assert f'<span class="nb-t">{ZH}讨论</span>{EN}Discussion</span></span>' in qa
    for c in site.courses:      # a course's name is never translated, so never marked
        page = (out / c.path / "index.html").read_text(encoding="utf-8")
        assert f"<h1>{c.code} {build.esc(c.name)}</h1>" in page, c.path
    css = (ROOT / "site/static/style.css").read_text(encoding="utf-8")
    assert 'html[data-lang="zh"] .l-en { display: none !important; }' in css and 'html[data-lang="en"] .l-zh { display: none !important; }' in css
