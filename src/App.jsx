// src/App.jsx
import ThemeToggle from "./ThemeToggle";
import React, { useEffect, useState } from "react";
import "./custom.css";
import TiptapEditor from "./TiptapEditor";

const VERSION = process.env.REACT_APP_VERSION || "";

export default function App() {
  const [targetGrade, setTargetGrade] = useState(6); // default Grade 6
  const [helpOpen, setHelpOpen] = useState(() => {
    try {
      return localStorage.getItem("ssHelpOpen") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("ssHelpOpen", helpOpen ? "1" : "0");
    } catch {}
  }, [helpOpen]);

  const copyPrompt = async () => {
    const prompt = [
      "Rewrite the following content in plain language that can be understood the first time it is read.",
      "Use everyday words.",
      "Keep sentences under 20 words where possible.",
      "Use 'you' and 'we.'",
      "Break things into bullet points if it helps.",
      "Define legal or technical terms in plain English.",
      "Make it sound like something you would say at a help desk.",
      "Aim for a 6th grade reading level.",
      "Keep the meaning accurate and respectful.",
      "",
      "Here is the text,",
      "[PASTE YOUR TEXT]"
    ].join(" ");
    try {
      await navigator.clipboard.writeText(prompt);
      alert("Prompt copied to clipboard.");
    } catch {
      alert("Could not copy, please copy it manually.");
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4">
<div className="flex items-center gap-3 mb-2">
  <h1 className="app-title">Sentence Scratcher</h1>
  <span className="version-badge">Version {process.env.REACT_APP_VERSION || ""}</span>
  <div className="ml-auto">
    <ThemeToggle />
  </div>
</div>

      <div className="mb-3">
        <label className="block text-sm font-medium mb-1">Target Grade Level:</label>
        <select
          className="border rounded px-2 py-1"
          value={targetGrade}
          onChange={(e) => setTargetGrade(parseInt(e.target.value, 10))}
        >
          <option value={6}>Grade 6</option>
          <option value={8}>Grade 8</option>
          <option value={10}>Grade 10</option>
        </select>
      </div>

      <TiptapEditor targetGrade={targetGrade} />

      {/* Help accordion, single, below the editor */}
      <details
        className="help-card mt-6"
        open={helpOpen}
        onToggle={(e) => setHelpOpen(e.currentTarget.open)}
      >
        <summary className="help-summary">
          Need help? Learn to plain language like a pro
        </summary>

        <div className="help-body">
          <section className="help-section">
            <h3>Step 1, Work one chunk at a time</h3>
            <p><strong>Do not paste a whole report.</strong> You will get weak output.</p>
            <p>Copy <strong>1 to 2 paragraphs</strong> at a time. It takes longer, the results are better.</p>
          </section>

          <section className="help-section">
            <h3>Step 2, Use the cheat code, AI</h3>
            <p>Paste your content into your AI tool with this prompt, then edit the result.</p>
            <pre className="help-pre">
{`Rewrite the following content in plain language that can be understood the first time it is read. Use everyday words. Keep sentences under 20 words where possible. Use "you" and "we." Break things into bullet points if it helps. Define legal or technical terms in plain English. Make it sound like something you would say at a help desk. Aim for a 6th grade reading level. Keep the meaning accurate and respectful.

Here is the text,
[PASTE YOUR TEXT]`}
            </pre>
            <div className="help-actions">
              <button className="btn" onClick={copyPrompt}>Copy prompt</button>
            </div>
            <p className="help-note">
              Tip, for non member content, you can aim for <strong>8th to 10th grade</strong> instead.
            </p>
          </section>

          <section className="help-section">
            <h3>Step 3, Use Sentence Scratcher</h3>
            <ul className="help-list">
              <li><strong>Target</strong>, Grade 6 when you can</li>
              <li>Fix <strong>yellow</strong> and <strong>red</strong> sentences</li>
              <li>Split long sentences, or use bullet lists</li>
            </ul>
          </section>

          <section className="help-section">
            <h3>Final checks</h3>
            <ul className="help-list">
              <li>The meaning did not change</li>
              <li>Important details are still there</li>
              <li>The tone feels like how you talk to a real person</li>
            </ul>
          </section>
        </div>
      </details>
    </div>
  );
}
