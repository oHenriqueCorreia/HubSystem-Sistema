-- Reuniões e compromissos também têm prioridade, como as tarefas: a agenda colore tudo pela mesma régua.
alter table public.calendar_events
  add column priority text check (priority in ('baixa', 'media', 'alta', 'urgente'));
