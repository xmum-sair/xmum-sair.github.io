"""Split the site's side-by-side Chinese and English into two halves a visitor can switch between.

The pages are written bilingually ("中文 | English", "中文<br>English", a Chinese paragraph followed by its English
one). localize() marks each half in the generated HTML:

    <span class="l-zh">中文</span><span class="l-sep"> | </span><span class="l-en">English</span>

and the stylesheet hides one half once <html data-lang> is set (base.html's first script: the visitor's stored choice,
otherwise the browser language). Without script nothing is hidden and the page reads as it always did.

The rule is conservative. A pair is split only when the left half has Chinese, the right half has none, and both carry
the same links and the same numbers; anything else stays as written, in both languages. Course names are English only
and so are never touched. Text inside class "l-zh" / "l-en" / "l-sep" or under data-nt is left alone, which is how a
page marks a pair by hand (bi() in build.py) or protects text that must not be split.

static/site.js applies the same text rule to what scripts add after the page loads, and to attributes (placeholder,
title, aria-label), <option> labels and the document title, where markup cannot go.
"""
from __future__ import annotations

import html as html_mod
import re

TOKEN_RE = re.compile(
    r"<!--.*?-->"
    r"|<(script|style|textarea|title|code|pre|svg|select|datalist)\b[^>]*>.*?</\1\s*>"   # kept verbatim
    r"|</?[a-zA-Z][^>]*>"
    r"|[^<]+|<", re.S | re.I)
VOID = {"br", "img", "input", "meta", "link", "hr", "wbr", "source"}
INLINE = {"a", "span", "small", "b", "strong", "em", "i", "time", "u", "s", "sup", "sub", "mark", "br", "img", "wbr"}
CJK_RE = re.compile(r"[㐀-䶿一-鿿]")
LATIN_RE = re.compile(r"[A-Za-z]")
NUM_RE = re.compile(r"\d+")
HREF_RE = re.compile(r'href="([^"]*)"')
CLASS_RE = re.compile(r'\bclass="([^"]*)"')
PIPE_RE = re.compile(r"\s*\|\s+|\s+\|\s*")
SLASH_RE = re.compile(r"\s*/\s+|\s+/\s*|(?<=[㐀-鿿）])/(?=[A-Za-z])")   # "学期 / Session", "昵称/Name"
LINE_RE = re.compile(r"\s*\n\s*")
SENTENCE_RE = re.compile(r"(?<=[。！？；：）」])\s*(?=[A-Z0-9\"'(])")
DOT_RE = re.compile(r" · ")
# what follows the English but belongs to both halves: a required-field star, an arrow, a colon, ": https://…"
TAIL_RE = re.compile(r"\s*(?:\*|→|[：:](?:\s*https?://\S+)?)\s*$")
ADDR_RE = re.compile(r"https?://[^\s<>\"]+|[\w.+-]+@[\w-]+\.[\w.-]+")
LEAD_RE = re.compile(r"^[^\w㐀-鿿「（(\[【《\"'“‘]*", re.U)   # icons, arrows, spaces before the words: shared by both halves
MARKED = ("l-zh", "l-en", "l-sep")
PAIR_TAGS = {"p", "ul", "ol", "blockquote"}


class El:
    __slots__ = ("name", "open", "children", "close")

    def __init__(self, name: str, open_tag: str):
        self.name, self.open, self.children, self.close = name, open_tag, [], ""

    def classes(self) -> list[str]:
        m = CLASS_RE.search(self.open)
        return m.group(1).split() if m else []

    def add_class(self, cls: str) -> None:
        if cls in self.classes():
            return
        if CLASS_RE.search(self.open):
            self.open = CLASS_RE.sub(lambda m: f'class="{m.group(1)} {cls}"', self.open, count=1)
        else:
            self.open = re.sub(r"^<([a-zA-Z][\w-]*)", rf'<\1 class="{cls}"', self.open, count=1)


class Raw(str):
    """Markup kept verbatim (scripts, code, comments): no text of its own for the language test."""


def parse(html: str) -> El:
    root = El("#root", "")
    stack = [root]
    for m in TOKEN_RE.finditer(html):
        tok = m.group(0)
        if m.group(1) or tok.startswith("<!--"):
            stack[-1].children.append(Raw(tok))
        elif tok.startswith("</"):
            name = re.match(r"</([a-zA-Z][\w-]*)", tok).group(1).lower()
            for depth in range(len(stack) - 1, 0, -1):
                if stack[depth].name == name:
                    del stack[depth + 1:]
                    stack.pop().close = tok
                    break
            else:
                stack[-1].children.append(Raw(tok))   # a stray closing tag: keep it where it was
        elif tok.startswith("<") and len(tok) > 1:
            name = re.match(r"<([a-zA-Z][\w-]*)", tok).group(1).lower()
            el = El(name, tok)
            stack[-1].children.append(el)
            if name not in VOID and not tok.endswith("/>"):
                stack.append(el)
        else:
            stack[-1].children.append(tok)
    return root


def dump(node) -> str:
    if isinstance(node, El):
        return node.open + "".join(dump(c) for c in node.children) + node.close
    return node


def text_of(nodes) -> str:
    out = []
    for n in nodes:
        if isinstance(n, El):
            out.append(text_of(n.children))
        elif not isinstance(n, Raw):
            out.append(html_mod.unescape(n))
    return "".join(out)


def _hrefs(nodes) -> list[str]:
    return sorted(HREF_RE.findall("".join(dump(n) for n in nodes)))


def is_pair(zh, en) -> bool:
    """Chinese on the left, none on the right, and nothing but the wording differs: same links, same numbers."""
    a, b = text_of(zh), text_of(en)
    if not CJK_RE.search(a) or CJK_RE.search(b) or not LATIN_RE.search(b):
        return False
    same = lambda rx: sorted(x.rstrip(".") for x in rx.findall(a)) == sorted(x.rstrip(".") for x in rx.findall(b))  # noqa: E731
    return _hrefs(zh) == _hrefs(en) and same(NUM_RE) and same(ADDR_RE)


def _is_marked(n) -> bool:
    return isinstance(n, El) and (any(c in MARKED for c in n.classes()) or "data-nt" in n.open)


def _span(cls: str, nodes) -> El:
    el = El("span", f'<span class="{cls}">')
    el.children, el.close = list(nodes), "</span>"
    return el


def _trim(nodes):
    """(leading whitespace, core nodes, trailing whitespace) of a run."""
    nodes = list(nodes)
    lead = trail = ""
    if nodes and isinstance(nodes[0], str) and not isinstance(nodes[0], Raw):
        s = nodes[0].lstrip()
        lead, nodes[0] = nodes[0][:len(nodes[0]) - len(s)], s
    if nodes and isinstance(nodes[-1], str) and not isinstance(nodes[-1], Raw):
        s = nodes[-1].rstrip()
        trail, nodes[-1] = nodes[-1][len(s):], s
    return lead, [n for n in nodes if n != ""], trail


def _wrap(zh, sep, en, log) -> list:
    """The marked-up pair. Icons and arrows in front of the Chinese stay outside it: both halves share them."""
    lead, zh, mid = _trim(zh)
    mid2, en, trail = _trim(en)
    shared = ""
    if zh and isinstance(zh[0], str) and not isinstance(zh[0], Raw):
        m = LEAD_RE.match(zh[0])
        if m and m.end() < len(zh[0]):
            shared, zh[0] = zh[0][:m.end()], zh[0][m.end():]
    if isinstance(sep, El):                      # <br> between the halves
        sep.add_class("l-sep")
        sep_nodes = [sep]
    else:
        sep_nodes = [_span("l-sep", [mid + sep + mid2])] if (mid + sep + mid2) else []
    if log is not None:
        log.append((text_of(zh).strip(), text_of(en).strip()))
    out = [lead + shared] if lead + shared else []
    return out + [_span("l-zh", zh)] + sep_nodes + [_span("l-en", en)] + ([trail] if trail else [])


def _pair(zh, sep, en, log):
    """The marked-up pair if zh and en are one, else None. What follows the English but belongs to both (a star, an
    arrow, a colon, an address) is taken off first and put back after the pair."""
    en, tail = list(en), ""
    if en and isinstance(en[-1], str) and not isinstance(en[-1], Raw) and (m := TAIL_RE.search(en[-1])) and m.start() > 0:
        tail, en[-1] = en[-1][m.start():], en[-1][:m.start()]
    if not is_pair(zh, en):
        return None
    return _wrap(zh, sep, en, log) + ([tail] if tail else [])


def _text_splits(run, regex):
    """Every place a separator matches in the run's own text nodes: (node index, start, end)."""
    return [(i, m.start(), m.end()) for i, n in enumerate(run) if isinstance(n, str) and not isinstance(n, Raw)
            for m in regex.finditer(n)]


def _cut(run, i, start, end):
    return run[:i] + [run[i][:start]], run[i][start:end], [run[i][end:]] + run[i + 1:]


def _small_tail(run, log):
    """"中文 <small>English</small>" and "中文 <span>| English</span>": the last element is the English half."""
    core = [i for i, n in enumerate(run) if isinstance(n, El) or n.strip()]
    last = run[core[-1]] if core else None
    if not (len(core) > 1 and isinstance(last, El) and last.name in ("small", "span") and not _is_marked(last)):
        return None
    zh, inner = run[:core[-1]], list(last.children)
    bar = ""
    if inner and isinstance(inner[0], str) and (m := re.match(r"\s*\|\s*", inner[0])):
        bar, inner[0] = inner[0][:m.end()], inner[0][m.end():]
    if not is_pair(zh, inner):
        return None
    lead, zh_core, gap = _trim(zh)
    wrapped = _wrap(zh_core, "", inner, log)
    en_span = wrapped.pop()                       # the English keeps its own element (and its styling)
    last.children = ([_span("l-sep", [bar])] if bar else []) + en_span.children
    last.add_class("l-en")
    return ([lead] if lead else []) + wrapped + ([_span("l-sep", [gap])] if gap else []) + [last] + run[core[-1] + 1:]


def split_run(run: list, log, use_br: bool = True) -> list:
    """One stretch of inline content → the same content with its Chinese and English halves marked, where it has them."""
    if not CJK_RE.search(text_of(run)):
        return run
    marked = [i for i, n in enumerate(run) if _is_marked(n)]
    if marked:                                    # a pair marked by hand: handle what is around it
        i = marked[0]
        return split_run(run[:i], log, use_br) + [run[i]] + split_run(run[i + 1:], log, use_br)

    pipes = _text_splits(run, PIPE_RE)
    brs = [i for i, n in enumerate(run) if isinstance(n, El) and n.name == "br"] if use_br else []
    if len(pipes) == 1:
        if (done := _pair(*_cut(run, *pipes[0]), log)) is not None:
            return done
    if not pipes and len(brs) == 1:
        if (done := _pair(run[:brs[0]], run[brs[0]], run[brs[0] + 1:], log)) is not None:
            return done
    if not pipes and not brs:
        if (done := _small_tail(run, log)) is not None:
            return done
        slashes = _text_splits(run, SLASH_RE)
        cuts = list(slashes)                      # several slashes: the one with Chinese before it and none after
        # "中文一句。\nAn English sentence." and "中文一句。An English sentence.": the same paragraph, both languages
        cuts += _text_splits(run, LINE_RE) + _text_splits(run, SENTENCE_RE)
        for cut in cuts:
            if (done := _pair(*_cut(run, *cut), log)) is not None:
                return done

    # no single split works: try the pieces between line breaks, then between " · ", then each text node on its own
    # and the inside of each inline element
    if brs:
        out, start = [], 0
        for i in brs + [len(run)]:
            out += split_run(run[start:i], log, use_br=False) + run[i:i + 1]
            start = i + 1
        return out
    dots = _text_splits(run, DOT_RE)
    if dots:
        i, s, e = dots[0]
        left, sep, right = _cut(run, i, s, e)
        return split_run(left, log, use_br) + [sep] + split_run(right, log, use_br)
    if len(run) == 1:
        if isinstance(run[0], El) and run[0].children:
            run[0].children = split_run(run[0].children, log)
        return run
    out = []
    for n in run:
        out += [n] if _is_marked(n) else split_run([n], log)
    return out


def _inline(n) -> bool:
    """A link around a whole card holds paragraphs: it is a block here, whatever its tag."""
    return not isinstance(n, El) or (n.name in INLINE and all(_inline(c) for c in n.children))


def _blocks(children):
    return [n for n in children if not _inline(n)]


def _has_marks(el: El) -> bool:
    return any(c in dump(el) for c in ('class="l-zh"', 'class="l-en"', " l-zh", " l-en"))


def pair_blocks(el: El, log) -> None:
    """A Chinese paragraph (or list) followed by its English one; a list whose first half is Chinese and second half
    the same items in English."""
    def twin(zh, en) -> bool:
        """A block and the block after it, in the other language. The position already says "translation", so the test
        is looser than is_pair() on numbers ("两三年" against "2-3 years") and stricter on shape: the same links and
        addresses, and a length an English rendering of that much Chinese could have."""
        a, b = text_of(zh).strip(), text_of(en).strip()
        if not CJK_RE.search(a) or CJK_RE.search(b) or not LATIN_RE.search(b):
            return False
        same = sorted(ADDR_RE.findall(a)) == sorted(ADDR_RE.findall(b))
        return _hrefs(zh) == _hrefs(en) and same and 0.8 <= len(b) / len(a) <= 7

    def items_of(block: El) -> list:
        return [n for n in _blocks(block.children) if n.name == "li"]

    def twins(a: El, b: El) -> bool:
        if a.name != b.name or a.name not in PAIR_TAGS or any(_has_marks(n) or _is_marked(n) for n in (a, b)):
            return False
        if a.name in ("ul", "ol"):        # item by item: the same number of items, each in its language
            xs, ys = items_of(a), items_of(b)
            return len(xs) == len(ys) and all(twin(x.children, y.children) for x, y in zip(xs, ys))
        return twin(a.children, b.children)

    blocks = _blocks(el.children)
    i = 0
    while i + 1 < len(blocks):
        a, b = blocks[i], blocks[i + 1]
        if twins(a, b):
            a.add_class("l-zh")
            b.add_class("l-en")
            if log is not None:
                log.append((text_of(a.children).strip(), text_of(b.children).strip()))
            i += 2
        else:
            i += 1
    if el.name in ("ul", "ol"):
        items = [n for n in blocks if n.name == "li"]
        half = len(items) // 2
        if (half and len(items) == 2 * half and not any(_has_marks(n) or _is_marked(n) for n in items)
                and all(twin(items[k].children, items[k + half].children) for k in range(half))):
            for k in range(half):
                items[k].add_class("l-zh")
                items[k + half].add_class("l-en")
                if log is not None:
                    log.append((text_of(items[k].children).strip(), text_of(items[k + half].children).strip()))


def walk(el: El, log) -> None:
    if _is_marked(el):
        return
    out, run = [], []
    for n in el.children:
        if not _inline(n):
            out += split_run(run, log) + [n]
            run = []
            walk(n, log)
        else:
            run.append(n)
    el.children = out + split_run(run, log)
    pair_blocks(el, log)


def localize(html: str, log: list | None = None) -> str:
    """The page with its two languages marked. Only <body> is touched; `log` collects the (Chinese, English) pairs."""
    m = re.search(r"<body\b[^>]*>", html, flags=re.I)
    end = html.rfind("</body>")
    if not m or end < 0:
        return html
    root = parse(html[m.end():end])
    walk(root, log)
    return html[:m.end()] + dump(root) + html[end:]


def _unmarked_text(nodes) -> str:
    out = []
    for n in nodes:
        if isinstance(n, El):
            out.append("" if _is_marked(n) else _unmarked_text(n.children))
        elif not isinstance(n, Raw):
            out.append(html_mod.unescape(n))
    return "".join(out)


def unsplit(html: str) -> list[str]:
    """Stretches of text that still hold both languages after localize(): candidates to mark by hand."""
    m = re.search(r"<body\b[^>]*>", html, flags=re.I)
    root = parse(html[m.end():html.rfind("</body>")]) if m else El("#root", "")
    found: list[str] = []

    def visit(el: El) -> None:
        if _is_marked(el):
            return
        run = []
        for n in el.children + [None]:
            if n is None or not _inline(n):
                t = re.sub(r"\s+", " ", _unmarked_text(run)).strip()
                if CJK_RE.search(t) and re.search(r"[A-Za-z]{3,}", t):
                    found.append(t)
                run = []
                if n is not None:
                    visit(n)
            else:
                run.append(n)

    visit(root)
    return found


def plain(html: str) -> str:
    """The page as it reads without the language marks ("中文 | English" again): for tests and other readers of the
    text. Spans this module (or bi()) added are unwrapped; a class added to an existing element is dropped."""
    def strip(el: El) -> str:
        inner = "".join(strip(c) if isinstance(c, El) else c for c in el.children)
        cls = el.classes()
        if el.name == "span" and len(cls) == 1 and cls[0] in MARKED:
            return inner
        opened = el.open
        if any(c in MARKED for c in cls):
            rest = " ".join(c for c in cls if c not in MARKED)
            opened = CLASS_RE.sub(f'class="{rest}"', opened, count=1) if rest else re.sub(r'\s+class="[^"]*"', "", opened, count=1)
        return opened + inner + el.close
    return strip(parse(html))
