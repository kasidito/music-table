-- booking_due only reads rows the caller can already see; run it with the caller's rights.
alter function public.booking_due(uuid) security invoker;
