# PII GUI

Domain language for the PII redaction app, as settled during feature design sessions.
Russian UI terms are canonical: all new Russian copy must use these words.

## Language

**Персональные данные (ПДн)**:
The Russian rendering of PII in user-facing copy. The product name "PII GUI" stays English everywhere.
_Avoid_: личная информация, персональная информация

**Маскировка**:
Hiding an approved match from the exported document (black box or text removal). Verb: «замаскировать».
_Avoid_: редактирование, цензура, обезличивание

**Находка**:
One detected PII occurrence that can be individually included in or excluded from redaction. Count form: «Найдено: N».
_Avoid_: совпадение (too literal for the review list), элемент

**Фильтр**:
The detection run over a document and the backend it uses («Запустить фильтр»).
_Avoid_: детектор, сканер

**Фрагмент**:
A token-bounded piece of a long document shown in progress indicators («Фрагмент 3 из 10»).
_Avoid_: кусок, блок текста
