-- Quiz enhancements: add 'calc' question type

ALTER TABLE interactive_questions
  DROP CONSTRAINT IF EXISTS interactive_questions_question_type_check;

ALTER TABLE interactive_questions
  ADD CONSTRAINT interactive_questions_question_type_check
  CHECK (question_type IN (
    'single_choice', 'multi_choice', 'text_short', 'text_long',
    'scale', 'email', 'phone', 'final_capture', 'result', 'calc'
  ));
