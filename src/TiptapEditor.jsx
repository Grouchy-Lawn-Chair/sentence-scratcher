// src/TiptapEditor.jsx
import "use-sync-external-store/shim";
import React, { useEffect, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Heading from "@tiptap/extension-heading";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import {
  analyzeSentence,
  countWords,
  countSentences,
  countSyllables,
  calculateFleschKincaidGrade,
  calculateFleschReadingEase,
} from "./readabilityUtils";
import { SIMPLE_WORD_MAP } from "./simpleWordMap";

/* ---------------- live settings stored at module scope ---------------- */
let CURRENT_TARGET_GRADE = 6;
let CURRENT_SHOW_HARD = true;
let CURRENT_EASY_SET = new Set();

/* ---------------- feature switches / thresholds ---------------- */
const ENABLE_BLUE = true;
const LONG_SENTENCE_WORDS = 15;

const DELTA_HARD = 1;
const DELTA_VERY_HARD = 3;

const MIN_YELLOW_WORDS_FOR_GRADE = 14;
const MIN_RED_WORDS_FOR_GRADE = 18;

const HARD_SYLLABLES_BY_TARGET = { 6: 3, 8: 4, 10: 5 };
const DEBOUNCE_MS = 250;

/* ---------------- helpers ---------------- */
const classify = (words, grade, target) => {
  const delta = grade - target;
  if (words < 8) return null;

  if (delta >= DELTA_VERY_HARD && words >= MIN_RED_WORDS_FOR_GRADE) return "red";
  if (delta >= DELTA_HARD && words >= MIN_YELLOW_WORDS_FOR_GRADE) return "yellow";

  if (ENABLE_BLUE && words >= LONG_SENTENCE_WORDS) return "blue";
  return null;
};

const tooltipMessage = (color) => {
  if (color === "red") return "Much harder than your target—simplify or split.";
  if (color === "yellow") return "A bit harder than your target—try simpler words or a split.";
  if (color === "blue") return "Long sentence—consider a split.";
  return "";
};

const smartCase = (orig, simple) => {
  if (!simple) return "";
  if (orig === orig.toUpperCase()) return simple.toUpperCase();
  if (orig[0] === orig[0].toUpperCase()) return simple[0].toUpperCase() + simple.slice(1);
  return simple;
};

const isAllCaps = (w) => w.length > 1 && w === w.toUpperCase();
const isUrlLike = (w) => /^https?:\/\//i.test(w) || /^www\./i.test(w);
const isNumberLike = (w) => /^\d/.test(w);
const isLikelyProperNoun = (w) => /^[A-Z][a-z]/.test(w) && !isAllCaps(w);
const splitIntoSentences = (text) => text.match(/[^.!?…]+[.!?…]*/g) || [];

/* ---------------- dynamic highlight extension ---------------- */
const decoKey = new PluginKey("sentenceHighlights");

const DynamicHighlights = Extension.create({
  name: "dynamicHighlights",
  addOptions() {
    return {
      getTargetGrade: () => CURRENT_TARGET_GRADE,
      getShowHardWords: () => CURRENT_SHOW_HARD,
      getEasySet: () => CURRENT_EASY_SET,
    };
  },
  addProseMirrorPlugins() {
    const { getTargetGrade, getShowHardWords, getEasySet } = this.options;

    const buildDecorations = (doc) => {
      const targetGrade = getTargetGrade();
      const showHardWords = getShowHardWords();
      const easySet = getEasySet();

      const decos = [];

      doc.descendants((node, pos) => {
        const isBlock = ["paragraph", "list_item", "heading"].includes(node.type.name);
        if (!isBlock) return;

        const text = node.textContent;
        if (!text) return;

        const blockFrom = pos + 1;
        const parts = splitIntoSentences(text);
        let searchFrom = 0;

        for (const raw of parts) {
          const s = raw.trim();
          if (!s) { searchFrom += raw.length; continue; }

          const { wordCount, grade } = analyzeSentence(s);
          const color = classify(wordCount, grade, targetGrade);

          const startInNode = text.indexOf(s, searchFrom);
          if (startInNode === -1) { searchFrom += raw.length; continue; }

          const from = blockFrom + startInNode;
          const to = from + s.length;

          if (color) {
            decos.push(
              Decoration.inline(from, to, {
                nodeName: "mark",
                "data-highlight-color": color,
                "data-tip": tooltipMessage(color),
              })
            );
          }

          if (showHardWords) {
            const thresh = HARD_SYLLABLES_BY_TARGET[targetGrade] ?? 3;
            const wordRegex = /\b[\w'-]+\b/g;
            let m, tokenIndex = 0;
            while ((m = wordRegex.exec(s)) !== null) {
              const wOrig = m[0];
              const w = wOrig.replace(/^'+|'+$/g, "");
              const lower = w.toLowerCase();

              if (!w || isUrlLike(w) || isNumberLike(w)) { tokenIndex++; continue; }
              if (tokenIndex > 0 && isLikelyProperNoun(wOrig)) { tokenIndex++; continue; }
              if (isAllCaps(wOrig)) { tokenIndex++; continue; }

              const syl = countSyllables(w);
              const isHard = syl >= (HARD_SYLLABLES_BY_TARGET[targetGrade] ?? 3);
              const isEasy = easySet.has(lower);

              if (!isEasy && isHard) {
                const suggestion = SIMPLE_WORD_MAP[lower] ? smartCase(wOrig, SIMPLE_WORD_MAP[lower]) : null;
                const tip = suggestion
                  ? `Likely hard word, try “${suggestion}”.`
                  : "Likely hard word, consider a simpler option.";
                const wFrom = from + m.index;
                const wTo = wFrom + wOrig.length;
                decos.push(
                  Decoration.inline(wFrom, wTo, {
                    "data-hard-word": "1",
                    "data-tip": tip || "",
                    style:
                      "text-decoration-line: underline; text-decoration-style: dotted; text-decoration-color: #7c3aed; text-decoration-thickness: 2px;",
                  })
                );
              }
              tokenIndex++;
            }
          }

          searchFrom = startInNode + s.length;
        }
      });

      return DecorationSet.create(doc, decos);
    };

    return [
      new Plugin({
        key: decoKey,
        state: {
          init: (_, state) => buildDecorations(state.doc),
          apply: (tr, old, _oldState, newState) => {
            const meta = tr.getMeta(decoKey);
            if (
              tr.docChanged ||
              meta === "recompute" ||
              (meta && typeof meta === "object" && "recompute" in meta)
            ) {
              return buildDecorations(newState.doc);
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            return decoKey.getState(state);
          },
        },
      }),
    ];
  },
});

/* ---------------- main component ---------------- */
export default function TiptapEditor({ targetGrade }) {
  const [stats, setStats] = useState({ wordCount: 0, sentenceCount: 0, grade: 0, ease: 0 });
  const [showHardWords, setShowHardWords] = useState(() => {
    try { return localStorage.getItem("ssShowHard") !== "0"; } catch { return true; }
  });
  const [easySet, setEasySet] = useState(() => new Set(MIN_EASY_WORDS));

  useEffect(() => { CURRENT_TARGET_GRADE = targetGrade; }, [targetGrade]);
  useEffect(() => { CURRENT_SHOW_HARD = showHardWords; }, [showHardWords]);
  useEffect(() => { CURRENT_EASY_SET = easySet; }, [easySet]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, bulletList: false, orderedList: false, listItem: false }),
      Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      BulletList,
      OrderedList,
      ListItem,
      Placeholder.configure({ placeholder: "Start typing, or paste your text here", includeChildren: true }),
      DynamicHighlights,
    ],
    content: "",
    editorProps: {
      attributes: {
        class:
          "editor-content prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none p-4 border rounded bg-white focus:outline-none",
      },
    },
  });

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + "/daleChallEasyWords.json")
      .then(r => (r.ok ? r.json() : []))
      .then(list => {
        if (Array.isArray(list) && list.length) {
          setEasySet(new Set(list.map(w => w.toLowerCase())));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!editor) return;
    const tr = editor.state.tr.setMeta(decoKey, { recompute: Date.now() });
    editor.view.dispatch(tr);
  }, [editor, targetGrade, showHardWords, easySet]);

  const debouncedStats = useCallback(() => {
    if (!editor) return;
    const fullText = editor.getText();
    setStats({
      wordCount: countWords(fullText),
      sentenceCount: countSentences(fullText),
      grade: calculateFleschKincaidGrade(fullText),
      ease: calculateFleschReadingEase(fullText),
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      window.clearTimeout(handler.tid);
      handler.tid = window.setTimeout(debouncedStats, DEBOUNCE_MS);
    };
    editor.on("update", handler);
    handler();
    return () => editor.off("update", handler);
  }, [editor, debouncedStats]);

  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;

    let tip = document.getElementById("ss-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "ss-tooltip";
      Object.assign(tip.style, {
        position: "fixed",
        zIndex: "9999",
        maxWidth: "28rem",
        padding: "6px 8px",
        fontSize: "12px",
        lineHeight: "1.25",
        color: "#111827",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: "4px",
        boxShadow: "0 4px 10px rgba(0,0,0,.08)",
        pointerEvents: "none",
        display: "none",
      });
      document.body.appendChild(tip);
    }

    const show = (e, text) => {
      tip.textContent = text || "";
      tip.style.left = `${e.clientX + 10}px`;
      tip.style.top = `${e.clientY + 12}px`;
      tip.style.display = text ? "block" : "none";
    };
    const hide = () => { tip.style.display = "none"; };

    const onMove = (e) => {
      const el = e.target.closest("[data-tip]");
      if (el && root.contains(el)) show(e, el.getAttribute("data-tip") || "");
      else hide();
    };

    if (!root.dataset.ssTipAttached) {
      root.addEventListener("mousemove", onMove);
      root.addEventListener("mouseleave", hide);
      root.dataset.ssTipAttached = "true";
    }

    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", hide);
      delete root.dataset.ssTipAttached;
      hide();
    };
  }, [editor]);

  useEffect(() => {
    try { localStorage.setItem("ssShowHard", showHardWords ? "1" : "0"); } catch {}
  }, [showHardWords]);

  if (!editor) return null;

  const hasText = stats.wordCount > 0 && stats.sentenceCount > 0;
  const gradeDisplay = hasText ? stats.grade.toFixed(1) : "—";
  const easeDisplay  = hasText ? stats.ease.toFixed(1)  : "—";

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap gap-2 mb-2">
        <button onClick={() => editor.chain().focus().toggleBold().run()} className={`px-2 py-1 border rounded ${editor.isActive('bold') ? 'bg-gray-200' : ''}`} aria-pressed={editor.isActive('bold')}>Bold</button>
        <button onClick={() => editor.chain().focus().toggleItalic().run()} className={`px-2 py-1 border rounded ${editor.isActive('italic') ? 'bg-gray-200' : ''}`} aria-pressed={editor.isActive('italic')}>Italic</button>
        <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={`px-2 py-1 border rounded ${editor.isActive('heading', { level: 1 }) ? 'bg-gray-200' : ''}`} aria-pressed={editor.isActive('heading', { level: 1 })} title="Heading 1">H1</button>
        <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={`px-2 py-1 border rounded ${editor.isActive('bulletList') ? 'bg-gray-200' : ''}`} aria-pressed={editor.isActive('bulletList')} title="Bulleted list">• List</button>
        <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={`px-2 py-1 border rounded ${editor.isActive('orderedList') ? 'bg-gray-200' : ''}`} aria-pressed={editor.isActive('orderedList')} title="Ordered list">1. List</button>
        <button onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} className="px-2 py-1 border rounded" title="Clear styles">Clear</button>
      </div>

      {/* legend */}
      <div className="flex flex-wrap gap-4 text-xs mb-2 items-center">
        <div className="flex items-center gap-1">
          <span className="legend-red w-3 h-3 border inline-block"></span>
          <span>Much harder than target</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="legend-yellow w-3 h-3 border inline-block"></span>
          <span>A bit harder than target</span>
        </div>
        {ENABLE_BLUE && (
          <div className="flex items-center gap-1">
            <span className="legend-blue w-3 h-3 border inline-block"></span>
            <span>Long sentence</span>
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={showHardWords}
              onChange={(e) => setShowHardWords(e.target.checked)}
            />
            {/* underline is on the label text now; no bold Aa glyph */}
            <span className="legend-underline-purple">Likely hard word</span>
          </label>
        </div>
      </div>

      {/* stats */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="bg-gray-100 px-2 py-1 rounded">Words, {stats.wordCount}</div>
        <div className="bg-gray-100 px-2 py-1 rounded">Sentences, {stats.sentenceCount}</div>
        <div className="bg-green-100 px-2 py-1 rounded">Grade, {gradeDisplay}</div>
        <div className="bg-blue-100 px-2 py-1 rounded">Ease, {easeDisplay}</div>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}

/* minimal easy-word seed; replaced by daleChallEasyWords.json on load */
const MIN_EASY_WORDS = [
  "a","about","after","all","also","an","and","any","are","as","at","back","be","because","been","before","but","by",
  "can","come","could","day","did","do","down","each","even","every","few","find","first","for","from","get","go",
  "good","had","has","have","he","her","here","him","his","how","i","if","in","into","is","it","just","know","like",
  "little","long","look","made","make","man","many","may","me","men","more","most","much","must","my","new","no",
  "not","now","of","off","old","on","one","only","or","other","our","out","over","people","right","said","see","she",
  "so","some","than","that","the","their","them","then","there","these","they","this","time","to","two","up","us",
  "use","very","want","was","way","we","well","went","were","what","when","where","which","who","will","with","work",
  "would","year","years","you","your"
];
