// src/TiptapEditor.jsx
import "use-sync-external-store/shim";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import {
  analyzeSentence,
  countWords,
  countSentences,
  calculateFleschKincaidGrade,
  calculateFleschReadingEase,
} from "./readabilityUtils";
import { SIMPLE_WORD_MAP } from "./simpleWordMap";

// feature switches, thresholds
const ENABLE_BLUE = false;
const LONG_SENTENCE_WORDS = 15;
const HEMI_HARD_WORDS = 20;
const HEMI_VERY_HARD_WORDS = 25;
const DELTA_HARD = 1;
const DELTA_VERY_HARD = 3;
const MIN_YELLOW_WORDS_FOR_GRADE = 14;
const MIN_RED_WORDS_FOR_GRADE = 18;
const HARD_SYLLABLES_BY_TARGET = { 6: 3, 8: 4, 10: 5 };
const DEBOUNCE_MS = 250;

const classify = (words, grade, target) => {
  const delta = grade - target;
  if (words >= HEMI_VERY_HARD_WORDS) return "red";
  if (words >= HEMI_HARD_WORDS) return "yellow";
  if (delta > DELTA_VERY_HARD && words >= MIN_RED_WORDS_FOR_GRADE) return "red";
  if (delta > DELTA_HARD && words >= MIN_YELLOW_WORDS_FOR_GRADE) return "yellow";
  if (ENABLE_BLUE && words >= LONG_SENTENCE_WORDS) return "blue";
  return null;
};

const smartCase = (orig, simple) => {
  if (!simple) return "";
  if (orig === orig.toUpperCase()) return simple.toUpperCase();
  if (orig[0] === orig[0].toUpperCase()) return simple[0].toUpperCase() + simple.slice(1);
  return simple;
};

const syllables = (word) => {
  const w = word.toLowerCase().replace(/[^a-z']/g, "");
  if (!w) return 0;
  const exceptions = { queue: 2, people: 2, business: 2, every: 2, family: 3, chocolate: 3 };
  if (w in exceptions) return exceptions[w];
  let count = 0;
  const vowels = "aeiouy";
  for (let i = 0; i < w.length; i++) {
    if (vowels.includes(w[i]) && !vowels.includes(w[i - 1] || "")) count++;
  }
  if (w.endsWith("e")) count--;
  return Math.max(1, count);
};

const isAllCaps = (w) => w.length > 1 && w === w.toUpperCase();
const isUrlLike = (w) => /^https?:\/\//i.test(w) || /^www\./i.test(w);
const isNumberLike = (w) => /^\d/.test(w);
const isLikelyProperNoun = (w) => /^[A-Z][a-z]/.test(w) && !isAllCaps(w);

// Tooltip text
const tooltipMessage = (color, { byLengthHard, byLengthYellow, byDeltaHard, byDeltaYellow }) => {
  if (color === "red") {
    if (byLengthHard && byDeltaHard) return "Very hard, long and above target, split and simplify.";
    if (byLengthHard) return "Very hard, 25 or more words, split this sentence.";
    if (byDeltaHard) return "Very hard, about 3 grades over target, split and simplify.";
  }
  if (color === "yellow") {
    if (byLengthYellow && byDeltaYellow) return "A bit long and above your target, consider a small rewrite.";
    if (byLengthYellow) return "A bit long, 20 or more words, consider a split.";
    if (byDeltaYellow) return "Slightly above your target, try simpler words or a split.";
  }
  if (color === "blue") return "Long sentence, consider a split.";
  return "";
};

// Decoration plugin
const decoKey = new PluginKey("sentenceHighlights");

const DynamicHighlights = Extension.create({
  name: "dynamicHighlights",
  addOptions() {
    return {
      getTargetGrade: () => 6,
      getShowHardWords: () => true,
      getEasySet: () => new Set(),
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

        const parts = text.match(/[^.!?…]+[.!?…]*/g) || [];
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

          const delta = grade - targetGrade;
          const byLengthHard = wordCount >= HEMI_VERY_HARD_WORDS;
          const byLengthYellow = wordCount >= HEMI_HARD_WORDS;
          const byDeltaHard = delta > DELTA_VERY_HARD && wordCount >= MIN_RED_WORDS_FOR_GRADE;
          const byDeltaYellow = delta > DELTA_HARD && wordCount >= MIN_YELLOW_WORDS_FOR_GRADE;

          if (color) {
            const tip = tooltipMessage(color, { byLengthHard, byLengthYellow, byDeltaHard, byDeltaYellow });
            decos.push(
              Decoration.inline(from, to, {
                nodeName: "mark",
                "data-highlight-color": color,
                "data-tip": tip || "",
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

              const isEasy = easySet.has(lower);
              const syl = syllables(w);
              const isHardBySyll = syl >= thresh;

              if (!isEasy && isHardBySyll) {
                const simple = SIMPLE_WORD_MAP[lower];
                const suggestion = simple ? smartCase(wOrig, simple) : null;
                const tip = suggestion
                  ? `Likely hard word, try “${suggestion}”.`
                  : "Likely hard word, consider a simpler option.";
                const wFrom = from + m.index;
                const wTo = wFrom + wOrig.length;
                decos.push(
                  Decoration.inline(wFrom, wTo, {
                    "data-hard-word": "1",
                    "data-tip": tip || "",
                    // CSS handles the underline, we still set a minimal style to keep Safari happy
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
            if (tr.docChanged || tr.getMeta(decoKey) === "recompute") {
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

export default function TiptapEditor({ targetGrade }) {
  const [stats, setStats] = useState({ wordCount: 0, sentenceCount: 0, grade: 0, ease: 0 });
  const [showHardWords, setShowHardWords] = useState(() => {
    try { return localStorage.getItem("ssShowHard") !== "0"; } catch { return true; }
  });
  const [easySet, setEasySet] = useState(() => new Set(MIN_EASY_WORDS));

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Start typing, or paste your text here",
        includeChildren: true,
      }),
      DynamicHighlights.configure({
        getTargetGrade: () => targetGrade,
        getShowHardWords: () => showHardWords,
        getEasySet: () => easySet,
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class:
          "editor-content prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none p-4 border rounded bg-white focus:outline-none",
      },
    },
  });

  // load Dale–Chall easy words once
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + "/daleChallEasyWords.json")
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        if (Array.isArray(list) && list.length) {
          setEasySet(new Set(list.map(w => w.toLowerCase())));
        }
      })
      .catch(() => {});
  }, []);

  // re build decorations when toggles or targetGrade change
  useEffect(() => {
    if (!editor) return;
    const tr = editor.state.tr.setMeta(decoKey, "recompute");
    editor.view.dispatch(tr);
  }, [editor, targetGrade, showHardWords, easySet]);

  // stats, run on content update only
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
    handler(); // first pass
    return () => editor.off("update", handler);
  }, [editor, debouncedStats]);

  // singleton tooltip that follows the mouse
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
        <button onClick={() => editor.chain().focus().toggleBold().run()} className="px-2 py-1 border rounded">Bold</button>
        <button onClick={() => editor.chain().focus().toggleItalic().run()} className="px-2 py-1 border rounded">Italic</button>
        <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className="px-2 py-1 border rounded">H1</button>
        <button onClick={() => editor.chain().focus().toggleBulletList().run()} className="px-2 py-1 border rounded">• List</button>
        <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className="px-2 py-1 border rounded">1. List</button>
      </div>

      {/* legend */}
      <div className="flex flex-wrap gap-4 text-xs mb-2 items-center">
        <div className="flex items-center gap-1">
          <span className="legend-red w-3 h-3 border inline-block"></span>
          <span>Very hard, 25+ words, or grade +3 with 18+ words</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="legend-yellow w-3 h-3 border inline-block"></span>
          <span>Slightly over, 20+ words, or grade +1 with 14+ words</span>
        </div>
        {ENABLE_BLUE && (
          <div className="flex items-center gap-1">
            <span className="legend-blue w-3 h-3 border inline-block"></span>
            <span>Long, {LONG_SENTENCE_WORDS}+ words</span>
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={showHardWords}
              onChange={(e) => setShowHardWords(e.target.checked)}
            />
            <span className="legend-underline-purple">Aa</span>
            <span>Likely hard word</span>
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
