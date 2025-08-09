// readabilityUtils.js

export function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function countSentences(text) {
  return text.split(/[.!?]+/).filter(s => s.trim().length > 0).length || 1;
}

export function countSyllables(word) {
  word = word.toLowerCase();
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

export function calculateFleschKincaidGrade(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = countSentences(text);
  const syllables = words.reduce((acc, word) => acc + countSyllables(word), 0);
  const wordCount = words.length || 1;

  const grade = 0.39 * (wordCount / sentences) + 11.8 * (syllables / wordCount) - 15.59;
  return parseFloat(grade.toFixed(1));
}

export function calculateFleschReadingEase(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = countSentences(text);
  const syllables = words.reduce((acc, word) => acc + countSyllables(word), 0);
  const wordCount = words.length || 1;

  const ease = 206.835 - 1.015 * (wordCount / sentences) - 84.6 * (syllables / wordCount);
  return parseFloat(ease.toFixed(1));
}

export function analyzeSentence(sentence) {
  const wordCount = countWords(sentence);
  const syllableCount = sentence
    .trim()
    .split(/\s+/)
    .reduce((acc, word) => acc + countSyllables(word), 0);
  const sentenceCount = 1; // It's just one sentence

  const grade =
    0.39 * (wordCount / sentenceCount) + 11.8 * (syllableCount / wordCount) - 15.59;

  return {
    text: sentence.trim(),
    wordCount,
    syllableCount,
    grade: parseFloat(grade.toFixed(1)),
  };
}
