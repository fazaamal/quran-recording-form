export type Harakah = "fatha" | "kasra" | "damma" | "sukoon";
export type Letter = "dad" | "ayn";

export type Stimulus = {
  id: string;
  kind: "letter" | "word";
  letter: Letter;
  harakah: Harakah;
  arabic: string;
  hint: string;
};

// Notes:
// - Word-level stimuli are chosen to place the target letter with the required harakah/sukoon.
// - All items include tashkīl.
export const stimuli: Stimulus[] = [
  // ض (Ḍād) letters
  { id: "dad_letter_fatha", kind: "letter", letter: "dad", harakah: "fatha", arabic: "ضَ", hint: "Ḍād with fatḥah" },
  { id: "dad_letter_kasra", kind: "letter", letter: "dad", harakah: "kasra", arabic: "ضِ", hint: "Ḍād with kasrah" },
  { id: "dad_letter_damma", kind: "letter", letter: "dad", harakah: "damma", arabic: "ضُ", hint: "Ḍād with ḍammah" },
  { id: "dad_letter_sukoon", kind: "letter", letter: "dad", harakah: "sukoon", arabic: "اَضْ", hint: "Short a (alif fatḥah), then Ḍād with sukūn" },

  // ض words
  { id: "dad_word_fatha", kind: "word", letter: "dad", harakah: "fatha", arabic: "ضَارَ", hint: "Read the word" },
  { id: "dad_word_kasra", kind: "word", letter: "dad", harakah: "kasra", arabic: "ضِعْفٌ", hint: "Read the word" },
  { id: "dad_word_damma", kind: "word", letter: "dad", harakah: "damma", arabic: "ضُمِرَ", hint: "Read the word" },
  { id: "dad_word_sukoon", kind: "word", letter: "dad", harakah: "sukoon", arabic: "يَضْرِبُ", hint: "Read the word" },

  // ع ('Ayn) letters
  { id: "ayn_letter_fatha", kind: "letter", letter: "ayn", harakah: "fatha", arabic: "عَ", hint: "ʿAyn with fatḥah" },
  { id: "ayn_letter_kasra", kind: "letter", letter: "ayn", harakah: "kasra", arabic: "عِ", hint: "ʿAyn with kasrah" },
  { id: "ayn_letter_damma", kind: "letter", letter: "ayn", harakah: "damma", arabic: "عُ", hint: "ʿAyn with ḍammah" },
  { id: "ayn_letter_sukoon", kind: "letter", letter: "ayn", harakah: "sukoon", arabic: "اَعْ", hint: "Short a (alif fatḥah), then ʿAyn with sukūn" },

  // ع words
  { id: "ayn_word_fatha", kind: "word", letter: "ayn", harakah: "fatha", arabic: "عَلِمَ", hint: "Read the word" },
  { id: "ayn_word_kasra", kind: "word", letter: "ayn", harakah: "kasra", arabic: "عِبَادَةٌ", hint: "Read the word" },
  { id: "ayn_word_damma", kind: "word", letter: "ayn", harakah: "damma", arabic: "عُمَرُ", hint: "Read the word" },
  { id: "ayn_word_sukoon", kind: "word", letter: "ayn", harakah: "sukoon", arabic: "مَعْلُومٌ", hint: "Read the word" },
];

