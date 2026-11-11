# Today

Today is the page a relative opens again tomorrow. It is the first section of every family, and it holds what changes
from day to day. The family's feed is its main part: what relatives wrote to each other, new memories and photographs,
and who was added to the tree ([feed.md](feed.md)). Beside it are the cards this page describes: this week's question
and the family's answers, the daily quiz, the week's birthdays and wedding anniversaries, what is new since the last
visit, where the reader stands in the Campaign's week while that is on, and one small thing the family still wants to know.

On a wide screen the cards are a column beside the feed. On a phone and a tablet they fold into one strip of buttons
above it (Question, Quiz, This week, What's new, and the Campaign and "One small thing" when they have something to
show); a button opens its card under the strip and closes it again, one at a time, so the screen starts with the family
and a way to write to it. The quiz's button carries a dot until today's question is answered.

The page is called Today in the three languages (Heute, Vandag). It is for members. A share-link guest has no Today
page, no feed, no question and no quiz.

## The question of the week

Each week (Monday to Sunday, UTC) the family is asked one question: "Who taught you to ride a bicycle?", "What did
Sunday lunch look like when you were little?". There are sixty, written in English, German and Afrikaans. They are
concrete and kind, a twelve-year-old and an eighty-five-year-old can both answer them, and none is about money,
illness or death. No AI is involved.

- **Which question:** each family gets the sixty in an order of its own, made from the family's id, and every question
  comes once before any comes round again. The choice needs no stored state: the same family and week always give the
  same question.
- **Answering:** a member with the role Contributor or higher writes a few sentences, about themself or about anyone in
  the tree. The answer is saved as an ordinary memory of that person, titled with the question and signed with the
  writer's account name. So it is in the Chronicle, in the family's feed (which says it is an answer) and on the
  person's page, and it is in the Markdown archive and the GEDCOM export like any other memory. A Viewer reads the answers and is told which role writing takes.
- **Together:** the card lists the week's answers. Earlier questions stay listed with their answers, and stay
  answerable for two years.
- **Stewards** can replace this week's question with one of their own (5 to 200 characters), skip the week, or take
  the suggested question back. Answers already given stay.

## The daily quiz: "Do you know your family?"

One question a day, made from the family's own records, the same for every member that day:

| Kind | Asks | Needs |
| --- | --- | --- |
| Shield | Whose shield is this? | three houses with different arms |
| Portrait | Who is this? | someone with a photo, or someone who has died |
| Parents | Who are the parents of X? | three couples with children |
| Birthplace | Where was X born? | three different birthplaces |
| Grandchild | Which of these is a grandchild of X? | a grandparent |
| Birth order | Put these three in order of birth | three people with a certain birth year |

- **One try.** A member picks, confirms, and the answer stands: it cannot be changed or sent again. The card then
  shows the right answer with a link to the person or house, and how the family did that day.
- **A streak** counts the days in a row a member has answered, right or wrong. **A table of houses** counts each
  month's right answers by the house of the person each member stands for.
- **The Campaign:** while that game is on, a right answer adds 2 troops to the first turn of the member's next reign
  that day (once a day).
- **A small family** gets the kinds its records can carry. A family with nothing to ask about yet is told what would
  help, with a link to the Needed page.
- **Variety:** yesterday's kind of question is tried last, a person or house rests for three weeks after a question
  about them, and about half the days prefer people the living knew (alive, born within a century, or gone within the
  last fifty years) while the others prefer older ancestors.
- **Stewards** can switch the quiz off under Games. It is on in a new family.

What the quiz never does: it never asks how or why somebody died, it builds no question from a lifespan, and it uses
only what every member may read.

## For developers

- **Pure and seeded.** `src/lib/today/week.ts` (which week, which question) and `src/lib/today/quiz.ts` (the day's
  question) read no clock and no database. `drawQuiz` gets the graph a Viewer may read (`PLAIN_MEMBER`), the family's
  id, the UTC day and what the last three weeks asked about.
- **Kept for the day.** The first reader of a day draws the question and it is stored (`quiz_day`), so later changes to
  the records do not change it and everyone is asked the same thing.
- **The answer stays on the server.** `quizView` sends the question without `answer` and `about` until the reader has
  a row in `quiz_answer`, whose primary key (`day`, `account`) is what keeps an answer to one. "Who is this?" names
  nobody: the picture comes from `/api/quiz-picture/<family>/<day>`, which serves the photo, or draws the portrait of
  someone who has died, without the page learning whose it is. A member who wants to cheat can still compare the
  picture or the shield with the tree; the quiz is a game, not an exam.
- **Days and weeks are UTC**, as in the Campaign.
- **Server functions** are in `src/lib/today/today.functions.ts`; every one needs a membership. The cards are in
  `src/components/today/`, one file each, and each fetches its own data.
- **The opening page.** The switch at the foot of Today ("Open the family on this page") is kept in the browser
  (`open:<family>`). It turns only the arrival at the family's plain address; a link to a person or a view is not
  turned.

## What is stored

Five tables in the family database (migration `tree/0028_today.sql`, see [data-model.md](data-model.md)):
`today_week` and `today_answer` belong to the family's records and are copied by the D1 transfer; `today_settings`,
`quiz_day` and `quiz_answer` are the game's, name members by account id, and are left out of the transfer. No export
contains the quiz. See [roles-and-privacy.md](roles-and-privacy.md), "Today".
