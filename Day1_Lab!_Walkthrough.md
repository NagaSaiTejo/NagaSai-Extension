# Day 1 — Lab 1A: AI Playground (Turnkey Walkthrough)

**Time:** 90 minutes (11:15 — 13:00)
**Format:** Individual at laptops, trainer demonstrates first
**Goal:** By end of lab, every mentor has filled a 4-tool comparison matrix on three real tasks AND can defend their tool choice in one sentence.

---

## Setup (5 minutes — before mentors run anything)

1. Each mentor opens four browser tabs **at the same window size** (full screen, side-by-side if possible):
   - https://chatgpt.com  (free tier — sign in with Google)
   - https://claude.ai  (free tier — sign in with Google)
   - https://gemini.google.com  (free — Google login)
   - https://perplexity.ai  (free tier — Google login)

2. Each mentor opens `templates/4tool_comparison_matrix.csv` from the lab kit, OR makes a copy of [the trainer's Google Sheet template] in their own Drive.

3. Trainer's anchor demonstration: score one cell aloud. "I'm giving ChatGPT a 4 on Task 1 because the structure is clean but it dropped the second-most-important point." This anchors what a "3" means vs a "5".

---

## Task 1 — Summarise (25 minutes)

### Article to paste into all 4 tools

Copy this entire block into each tool. Same prompt, same article, same time.

> **Prompt:** "Summarise this article in 5 bullet points. Each bullet: maximum 15 words. Do not lose the key claims. Do not add information not in the article."
>
> **Article (~800 words):**
>
> AI is rapidly changing campus placement training in Indian engineering colleges. As of 2025, over 60% of B.Tech students at Tier-1 colleges report using ChatGPT or similar tools to prepare for placement interviews. By 2028, this figure is projected to reach 95% across all engineering colleges in India.
>
> The shift began modestly. In 2023, students used AI primarily to draft cover letters and rewrite résumés. By 2024, AI use expanded into mock interview preparation — students would ask ChatGPT to "ask me 10 placement-style questions on data structures" and rehearse answers. By 2025, the pattern matured: students arrive at HR interviews having already simulated 50+ mock interviews with AI, often with prepared answers polished across 20 iterations.
>
> Recruiters have noticed. Industry data from NASSCOM shows interview rounds taking 35% longer in 2025 than in 2023, primarily because recruiters now embed unscripted "tell me about a real failure" follow-up questions designed to penetrate rehearsed AI-coached answers. Several companies including Infosys, TCS, and Capgemini have introduced live coding rounds with no internet access — a direct response to the rise of AI-assisted preparation.
>
> The shift creates two problems for placement cells. First, the gap between AI-fluent and AI-unfluent students has widened sharply. A 2025 survey of 4,000 B.Tech students found that students who had used AI for placement prep for at least 6 months were 2.4 times more likely to receive a Tier-1 company offer than peers who had not. This raises equity concerns, particularly for first-generation college students who lack early exposure to AI tools.
>
> Second, placement cells themselves are unevenly equipped. A 2025 AICTE survey found only 18% of placement officers across Indian engineering colleges had completed any formal training on AI tools. The remaining 82% rely on student-driven adoption, which produces inconsistent quality and uneven verification. Several universities have responded by launching mentor-training programs designed to upskill placement staff to teach AI-augmented placement preparation responsibly.
>
> The pedagogical challenge is not technical. AI tools are intuitive; any motivated student picks them up in days. The challenge is verification. Frontier AI models are confidently wrong on 8 to 12 percent of factual answers, according to multiple benchmarks. A student who memorises an AI-generated interview answer about "the latest AICTE regulations" may walk into an interview and confidently state a regulation that does not exist. Multiple recruiters report seeing this exact pattern in 2025.
>
> The solution emerging in 2026 is structural: teach students the verification chain alongside the AI tool. The chain has three steps. First, ask AI. Second, ask a second source — typically Perplexity, which cites primary sources — to verify the claim. Third, open the primary source URL directly and confirm the number, date, or fact yourself. Students trained on this chain report 60% fewer factual errors in mock interviews.
>
> The verification chain has secondary benefits. Students develop research skills they would not have developed by passive memorisation. They build the habit of source-checking that recruiters now actively test for in live interview rounds. They also internalise a healthy scepticism: AI is a tool, not an oracle.
>
> Looking ahead to 2027 and 2028, the dominant trend will be agentic AI. Students will move from "ask AI a question" to "deploy an AI agent that researches, drafts, and rehearses on your behalf." Multi-agent placement preparation systems are already in beta at IIT Bombay and BITS Pilani. By 2028, observers expect 70% of placement-prep workflows in India to involve some form of agent orchestration.
>
> For placement officers, the implication is clear: training AI literacy is no longer optional. The students they fail to upskill will arrive at placement interviews already 12 to 18 months behind their AI-fluent peers — a gap that widens annually. The 2026 cohort of placement officers being trained today through programs at universities like Aditya University will define the verification standards their students inherit.
>
> The technology will keep moving. Frontier models will improve. Hallucination rates will drop. New tools will emerge. But the structural challenge — bridging tool fluency with verification discipline — will remain. Placement training in 2028 will look fundamentally different from 2023, but the principles that govern it will not.

### What each tool will likely give you

This is what to score against. Use these as anchors when reviewing mentor matrices.

| Tool | Expected output style | Common strength | Common weakness |
|------|----------------------|-----------------|-----------------|
| **ChatGPT** | 5 well-formed bullets, balanced coverage | Clean structure, conversational tone | May skip the AICTE 18% statistic; over-summarises |
| **Claude** | 5 thorough bullets with sub-points if you let it | Best at preserving nuance and quotes | Sometimes goes over the 15-word/bullet limit |
| **Gemini** | 5 bullets, sometimes adds source links | Strong on numeric facts (60%, 35%, 8-12%) | Style varies — sometimes too curt |
| **Perplexity** | 5 bullets WITH inline citations | Cites the article + adds external sources | Smaller bullet count if asked nicely; less clean structure |

### Scoring guide for Task 1

| Score | Faithfulness | Structure | Brevity |
|-------|-------------|-----------|---------|
| 5 | All key claims preserved, no fabrication | Numbered, parallel form, easy to read | Every bullet ≤ 15 words |
| 3 (anchor) | Most key claims preserved, 1-2 minor omissions | Mostly clean, 1 awkward bullet | One or two bullets slightly long |
| 1 | Major omission, fabrication, or misattribution | Inconsistent format, prose blocks | Long-winded, ignored word limit |

---

## Task 2 — Code (25 minutes)

### Prompt to paste into all 4 tools

Same prompt, all four:

> "Write a Python function `score_resume_against_jd(resume_text: str, jd_text: str) -> dict` that returns `{"score": int 0-100, "reasoning": str, "missing_skills": list[str]}`. The score should reflect how well the résumé matches the job description. Use only the standard library — no external API calls. Include a brief docstring and one usage example."

### What to watch for in each tool's code

| Tool | Likely approach | Quality signal | Failure mode |
|------|-----------------|---------------|--------------|
| **ChatGPT** | Keyword overlap + cosine similarity (TF-IDF) using collections.Counter | Clean, readable, idiomatic | Often skips the docstring or uses external libs without saying |
| **Claude** | More elaborate — may suggest multiple scoring approaches | Most thorough explanation, good edge cases | Sometimes over-engineered for the prompt |
| **Gemini** | Often suggests using sklearn (which violates the "standard library only" constraint) | Concise | Most likely to break the constraint — interesting teaching moment |
| **Perplexity** | Often wraps in a "here's a basic approach" disclaimer + cites StackOverflow | Cites real sources | May give shorter / less complete code |

### Scoring guide for Task 2

| Score | Correctness | Readability | Constraint adherence |
|-------|-------------|-------------|---------------------|
| 5 | Function works on test input, handles edge cases | Clean naming, docstring present, comments useful | Standard library only, returns specified dict shape |
| 3 (anchor) | Works on simple input, breaks on edge cases | Readable but inconsistent | One soft constraint violation (e.g., uses re module ambiguously) |
| 1 | Doesn't run, or returns wrong shape | Cryptic, no docstring | Imports sklearn / spaCy / etc. despite constraint |

### Test the code (optional, 2 min)

Have mentors run their favorite tool's code with this test input:

```python
resume = "Python developer with 3 years experience in Django, REST APIs, PostgreSQL. Built 2 production apps."
jd = "Seeking Python backend engineer. Required: Django, PostgreSQL, REST API design, Docker. Nice-to-have: Kubernetes, AWS."
print(score_resume_against_jd(resume, jd))
```

Expected output should mention: missing Docker, Kubernetes, AWS. Score should be in the 50-70 range (good match on core, missing nice-to-haves).

---

## Task 3 — Reason (25 minutes)

### Logic puzzle to paste into all 4 tools

Same exact prompt:

> "Three students share a hostel room and have college on the same morning. The first student leaves at 7:00 AM. The second student leaves 30 minutes after the first. The third student leaves 15 minutes after the second. The third student's class starts at 8:30 AM, and his class is exactly a 25-minute walk from the hostel. Does the third student arrive on time? Show your reasoning step by step."

### Worked solution

- Student 1 leaves at 7:00 AM
- Student 2 leaves at 7:00 + 30 = **7:30 AM**
- Student 3 leaves at 7:30 + 15 = **7:45 AM**
- Student 3's walk takes 25 minutes → arrives at 7:45 + 25 = **8:10 AM**
- Class starts at 8:30 AM → Student 3 arrives **20 minutes early. Yes, on time.**

### What to watch for in each tool's response

| Tool | Likely response style | Strength | Failure mode |
|------|----------------------|----------|--------------|
| **ChatGPT** | Step-by-step calculation, conversational | Good at showing each step | Sometimes jumps to answer without showing work |
| **Claude** | Most thorough chain-of-thought, may even add caveats | Best transparent reasoning | Verbose — may go on too long |
| **Gemini** | Often gives the answer first, then explains | Concise | Sometimes drops a step in the timing chain |
| **Perplexity** | Treats it as a research task — may search for similar puzzles | Cites if it borrows from a known puzzle | Weakest at pure reasoning — built for search |

### Scoring guide for Task 3

| Score | Accuracy | Transparency | Confidence calibration |
|-------|----------|--------------|------------------------|
| 5 | Correct answer (8:10 AM, on time, 20 min early) | Every step shown explicitly | States the answer with appropriate confidence |
| 3 (anchor) | Correct answer | Some steps shown, some implicit | Reasonably confident |
| 1 | Wrong answer or incoherent | No reasoning, just an answer | Confidently wrong |

### The teaching moment

If any tool gets this WRONG, that is the most valuable teaching moment of the day. Pause the room. Show the wrong answer on the projector. Ask the mentors: "What does this tell you about that tool's reasoning?" The lesson lands harder when a tool fails publicly.

---

## Filling the matrix (10 minutes)

After all 3 tasks, each mentor's matrix looks like this:

| Tool | Task 1 (Summarise) | Task 2 (Code) | Task 3 (Reason) | My Verdict |
|------|--------------------|---------------|-----------------|------------|
| ChatGPT | 4 | 4 | 4 | _All-rounder. Best default choice for general tasks._ |
| Claude | 5 | 4 | 5 | _Best for thorough writing and careful reasoning. Slower._ |
| Gemini | 4 | 3 | 3 | _Good for quick factual queries. Weaker at code constraints._ |
| Perplexity | 4 | 3 | 2 | _Best when I need cited sources. Weakest for pure reasoning._ |

These verdicts vary by mentor; what matters is they are **defended** with the matrix scores.

---

## The 3-sentence conclusion (5 minutes)

Each mentor commits to memory and writes in their `Day1_Setup.ipynb` README:

> "I would use **ChatGPT** for general tasks where I need a fast, well-structured response."
>
> "I would use **Claude** for long documents, careful reasoning, and high-stakes writing."
>
> "I would use **Perplexity** for any factual claim I cannot afford to get wrong."

(Gemini gets folded into "general use" or "multilingual / image" depending on what the mentor surfaced.)

---

## Trainer notes — what to watch for during the lab

1. **A mentor scores everything 4 or 5.** Re-anchor the 3 aloud: "A 3 means it works but I had to fix something." Use a real example from one of their submissions.

2. **A mentor swaps to a paid model "to be fair".** Reject. The lab is specifically about free-tier comparison because that's what their students will use.

3. **A mentor finishes Task 1 in 10 minutes.** Give the stretch goal: add a 5th task — multi-modal. "Upload an image to all four. Which actually accept and analyse it?" Gemini wins this one decisively, which is itself the lesson.

4. **A mentor cannot log in to one of the tools.** Backup keys / temporary Google accounts are in 1Password (you set this up T-2 weeks). Do not waste 20 min on login issues; provision and move on.

5. **The room disagrees on a verdict.** Surface it on the projector. Two mentors with different verdicts read aloud their reasoning. The disagreement IS the lesson — there is no "right" tool.

---

## Acceptance check before lunch

Every mentor must show you (raise of hands or screen-share):
- ✅ Matrix with all 12 cells filled with concrete reasoning (not 1-word scores)
- ✅ 3-sentence conclusion in their Day 1 README
- ✅ Pushed to public GitHub repo (verify the green checkmark on github.com)

If any mentor is missing items by 12:55, pair them with you for a 5-minute catch-up before lunch. No one leaves with an incomplete lab.
