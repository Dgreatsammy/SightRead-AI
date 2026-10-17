# Recognition accuracy benchmark

How the score reader (Audiveris) was measured. The comparison code lives in
`artifacts/sightread-ai/src/lib/omrAccuracy.ts` (`compareScores`); the python
files here only make degraded copies of a page. Paths inside them are examples.

## Method
1. Take a PDF and the clean MusicXML of the SAME piece (CPDL pages offer both).
2. Make copies of page 1 at different qualities:
   - **clean**: the PDF itself.
   - **whatsapp**: 1600 px long side, JPEG quality 65 (`prep_whatsapp.py`).
   - **poor**: 1100 px long side, JPEG quality 45, about the size of a photo
     forwarded a few times (777 x 1100 px).
3. Read each with the same options as the server (`-sheets 1-4 -transcribe -export`).
4. `compareScores(trueXml, readXml)` reports notes, melody, bass, rhythm,
   spelling, key, time signature, bar count and invented marks.

## Results (five CPDL pieces, October 2026)
Average over the four single-page pieces (Regent Square, Dix, Away in a Manger, Ding Dong):

| Image | Notes right | Melody | Bass | Rhythm | Spelling (verse 1) |
|---|---|---|---|---|---|
| Clean PDF | 95.9% | 96.5% | 97.0% | 98.4% | 85.8% |
| WhatsApp-sized (1600 px) | 92.1% | 92.6% | 92.3% | 95.6% | 56.8% |
| Poor (777 x 1100 px) | 75.9% | 74.3% | 76.3% | 91.8% | 50.7% |

Christians Awake (two pages, 48 bars) on the clean PDF: 99.8% notes, 99.0% spelling.

## Findings
- Notes are read well from clean PDFs; the words are the fragile part and fall fast as quality drops.
- Page footers (credits, URLs, "edition") are read as sung words in most runs.
- Verse lines are sometimes attached to the wrong verse number (Away in a Manger).

## Clean-up experiments on small images (notes right, %)
| Piece | Today's clean-up | Enlarge 3x | Black and white |
|---|---|---|---|
| Regent Square, 777 px | 89.8 | 91.8 | 100 |
| Dix, 777 px | 90.7 | 97.1 | 98.7 |
| Away in a Manger, 777 px | 77.8 | 91.7 | 92.0 |
| Ding Dong, 777 px | 45.1 | 73.3 | 82.3 |

At 1300 px it was mixed (Manger 91.3 to 95.1, Ding Dong 78.6 to 72.2). With uneven
light, a single black-and-white cut-off could be worse than today's clean-up
(Manger 80.9 to 69.5); a local, adaptive cut-off was best for Manger (90.5) and
better than today's for Ding Dong (52.3 to 66.9), though a global cut-off did better
there (80.1). Median-filter "denoising" erased the staff lines and failed outright.

Only four pieces and synthetic degradation (no real phone photos), so this is a lead,
not a finding to ship. More pairs are needed first.
