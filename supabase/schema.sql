-- Windsammler: Ranglisten in Gruppen mit Einladungscode.
-- Idempotent – kann nach Änderungen beliebig oft erneut ausgeführt werden.
--
-- Datenschutz: Gespeichert werden nur Spielername, gesammelte Anlagen und Zeitpunkte.
-- Die Position des Handys wird beim Sammeln geprüft, aber nicht gespeichert.
-- Andere Nutzer sehen Namen und Punkte nur innerhalb gemeinsamer Gruppen – in der globalen
-- Rangliste nur, wer das selbst einschaltet (profile.global). Kommentare zu Anlagen sehen
-- alle angemeldeten Spieler mit dem Spielernamen des Verfassers.

-- ---------------------------------------------------------------- Tabellen

create table if not exists public.anlagen (
  id      text primary key,               -- MaStR-Nummer der Einheit
  lat     double precision not null,
  lon     double precision not null,
  marke   text,
  modell  text,
  kw      real,
  nabe    real,
  ibn     date,
  planung boolean not null default false,
  selten  boolean not null default false  -- Modell mit höchstens 20 Anlagen in Deutschland
);

create table if not exists public.profile (
  id       uuid primary key references auth.users (id) on delete cascade,
  name     text not null check (char_length(btrim(name)) between 2 and 24),
  erstellt timestamptz not null default now()
);

-- Spielernamen eindeutig (ohne Rücksicht auf Groß-/Kleinschreibung und Leerzeichen am Rand).
-- Einmalig: ältere Doppelungen umbenennen („Name 2“, „Name 3“ …), das älteste Konto behält den Namen.
do $$
declare r record;
begin
  if to_regclass('public.profile_name_eindeutig') is not null then return; end if;
  for r in select id, name, row_number() over (partition by lower(btrim(name)) order by erstellt, id) as nr from public.profile loop
    if r.nr > 1 then
      update public.profile set name = left(btrim(r.name), 21) || ' ' || r.nr where id = r.id;
    end if;
  end loop;
end $$;
create unique index if not exists profile_name_eindeutig on public.profile (lower(btrim(name)));

create table if not exists public.gruppen (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 2 and 40),
  code         text not null unique,
  erstellt_von uuid references public.profile (id) on delete set null,
  erstellt     timestamptz not null default now()
);

create table if not exists public.mitglieder (
  gruppe      uuid not null references public.gruppen (id) on delete cascade,
  nutzer      uuid not null references public.profile (id) on delete cascade,
  beigetreten timestamptz not null default now(),
  primary key (gruppe, nutzer)
);

create table if not exists public.funde (
  nutzer uuid not null references public.profile (id) on delete cascade,
  anlage text not null references public.anlagen (id),
  zeit   timestamptz not null default now(),
  punkte integer not null,
  primary key (nutzer, anlage)
);

-- Turm berührt (unter 20 m an der Anlage, gibt Bonuspunkte)
alter table public.funde add column if not exists beruehrt timestamptz;
-- In der globalen Rangliste sichtbar (freiwillig, Standard: aus)
alter table public.profile add column if not exists global boolean not null default false;

-- Bewertungen/Kommentare: eine pro Spieler und Anlage, nur für selbst gesammelte Anlagen
create table if not exists public.kommentare (
  id      uuid primary key default gen_random_uuid(),
  nutzer  uuid not null references public.profile (id) on delete cascade,
  anlage  text not null references public.anlagen (id),
  sterne  smallint not null check (sterne between 1 and 5),
  text    text not null default '' check (char_length(text) <= 500),
  zeit    timestamptz not null default now(),
  unique (nutzer, anlage)
);
create index if not exists kommentare_anlage on public.kommentare (anlage, zeit desc);

-- Meldungen unangemessener Kommentare; ab 3 Meldungen wird ein Kommentar ausgeblendet
create table if not exists public.meldungen (
  kommentar uuid not null references public.kommentare (id) on delete cascade,
  nutzer    uuid not null references public.profile (id) on delete cascade,
  zeit      timestamptz not null default now(),
  primary key (kommentar, nutzer)
);

-- Blockierte Spieler: deren Kommentare sieht man nicht mehr (App-Store-Vorgabe für Nutzerinhalte)
create table if not exists public.blockiert (
  id        uuid primary key default gen_random_uuid(),
  nutzer    uuid not null references public.profile (id) on delete cascade,
  blockiert uuid not null references public.profile (id) on delete cascade,
  zeit      timestamptz not null default now(),
  unique (nutzer, blockiert)
);

-- Betreiber-Konten für die Admin-Seite (web/admin.html). Eintragen nur per SQL Editor:
--   insert into public.admins (nutzer) values ('<Konto-ID von der Admin-Seite>');
create table if not exists public.admins (
  nutzer uuid primary key references auth.users (id) on delete cascade
);
-- Wann eine Meldung zuletzt geprüft und verworfen wurde
alter table public.kommentare add column if not exists geprueft timestamptz;

-- Fehlgeschlagene Beitrittsversuche (gegen Durchprobieren von Einladungscodes)
create table if not exists public.beitritt_fehler (
  nutzer uuid not null references auth.users (id) on delete cascade,
  zeit   timestamptz not null default now()
);
create index if not exists beitritt_fehler_nutzer on public.beitritt_fehler (nutzer, zeit);

-- Passwort zum Wiederherstellen des Kontos (z. B. nach gelöschtem Browserspeicher oder auf einem
-- neuen Gerät). Nur als bcrypt-Hash gespeichert; kein direkter Zugriff, nur über die Funktionen unten.
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.passwoerter (
  nutzer    uuid primary key references public.profile (id) on delete cascade,
  hash      text not null,
  geaendert timestamptz not null default now()
);
-- Fehlgeschlagene Anmeldungen mit Passwort (gegen Durchprobieren)
create table if not exists public.login_fehler (
  name   text not null,
  nutzer uuid not null,
  zeit   timestamptz not null default now()
);
create index if not exists login_fehler_name on public.login_fehler (name, zeit);
create index if not exists login_fehler_nutzer on public.login_fehler (nutzer, zeit);

create index if not exists funde_anlage_zeit on public.funde (anlage, zeit);
create index if not exists funde_nutzer_zeit on public.funde (nutzer, zeit desc);
create index if not exists mitglieder_nutzer on public.mitglieder (nutzer);

-- ---------------------------------------------------------------- Zugriffsregeln
-- Direkter Tabellenzugriff nur aufs eigene Profil und die eigenen Funde;
-- alles andere läuft über die Funktionen unten.

alter table public.anlagen    enable row level security;
alter table public.profile    enable row level security;
alter table public.gruppen    enable row level security;
alter table public.mitglieder enable row level security;
alter table public.funde      enable row level security;
alter table public.beitritt_fehler enable row level security;
alter table public.kommentare enable row level security;
alter table public.meldungen  enable row level security;
alter table public.blockiert  enable row level security;
alter table public.admins     enable row level security;
alter table public.passwoerter enable row level security;
alter table public.login_fehler enable row level security;

drop policy if exists profil_lesen on public.profile;
drop policy if exists profil_anlegen on public.profile;
drop policy if exists profil_aendern on public.profile;
drop policy if exists funde_lesen on public.funde;

create policy profil_lesen   on public.profile for select to authenticated using (id = auth.uid());
create policy profil_anlegen on public.profile for insert to authenticated with check (id = auth.uid());
create policy profil_aendern on public.profile for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy funde_lesen    on public.funde   for select to authenticated using (nutzer = auth.uid());

-- ---------------------------------------------------------------- Hilfsfunktionen

create or replace function public.distanz_m(lat1 float8, lon1 float8, lat2 float8, lon2 float8)
returns float8 language sql immutable set search_path = '' as $$
  select 12742000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2))))
$$;

create or replace function public._nutzer()
returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Nicht angemeldet'; end if;
  if not exists (select 1 from public.profile where id = v) then raise exception 'Kein Spielerprofil'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- Sammeln

-- p_zeit: Zeitpunkt eines offline gesammelten Funds (höchstens 48 h zurück)
create or replace function public.sammeln(p_anlage text, p_lat float8, p_lon float8, p_zeit timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public._nutzer();
  v_zeit  timestamptz := least(now(), greatest(coalesce(p_zeit, now()), now() - interval '48 hours'));
  a       public.anlagen;
  l       record;
  v_weg   float8;
  v_marke boolean;
  v_modell boolean;
  v_erst  boolean;
  v_punkte integer;
begin
  select * into a from public.anlagen where id = p_anlage;
  if not found then raise exception 'Unbekannte Anlage'; end if;
  if a.planung then raise exception 'Anlage ist erst in Planung'; end if;
  if public.distanz_m(p_lat, p_lon, a.lat, a.lon) > 300 then raise exception 'Zu weit von der Anlage entfernt'; end if;

  if exists (select 1 from public.funde where nutzer = v_uid and anlage = p_anlage) then
    return jsonb_build_object('doppelt', true, 'punkte', 0);
  end if;

  if (select count(*) from public.funde where nutzer = v_uid and zeit > now() - interval '24 hours') >= 300 then
    raise exception 'Tageslimit erreicht';
  end if;

  -- Plausibilität: zwischen zwei Funden höchstens ~250 km/h (600 m Toleranz für GPS-Ungenauigkeit)
  select f.zeit, x.lat, x.lon into l
    from public.funde f join public.anlagen x on x.id = f.anlage
   where f.nutzer = v_uid
   order by abs(extract(epoch from f.zeit - v_zeit))
   limit 1;
  if found then
    v_weg := public.distanz_m(l.lat, l.lon, a.lat, a.lon) - 600;
    if v_weg > 0 and v_weg / greatest(abs(extract(epoch from v_zeit - l.zeit)), 1) > 70 then
      raise exception 'Unplausibel schnell unterwegs';
    end if;
  end if;

  v_marke := a.marke is not null and not exists (
    select 1 from public.funde f join public.anlagen x on x.id = f.anlage
     where f.nutzer = v_uid and x.marke = a.marke);
  v_modell := a.modell is not null and not exists (
    select 1 from public.funde f join public.anlagen x on x.id = f.anlage
     where f.nutzer = v_uid and x.marke is not distinct from a.marke and x.modell = a.modell);
  v_erst := not exists (select 1 from public.funde where anlage = p_anlage);

  v_punkte := 1
    + case when v_modell then 5 else 0 end
    + case when v_marke then 10 else 0 end
    + case when v_modell and a.selten then 20 else 0 end
    + case when v_erst then 3 else 0 end;

  insert into public.funde (nutzer, anlage, zeit, punkte)
  values (v_uid, p_anlage, v_zeit, v_punkte)
  on conflict do nothing;

  return jsonb_build_object(
    'punkte', v_punkte, 'neue_marke', v_marke, 'neues_modell', v_modell,
    'selten', v_modell and a.selten, 'erstentdecker', v_erst);
end $$;

-- Turm berührt: unter 20 m (+2). Wer als Erste/r überhaupt berührt, bekommt +3 dazu.
-- Noch nicht gesammelte Anlagen werden dabei mitgesammelt.
create or replace function public.beruehren(p_anlage text, p_lat float8, p_lon float8, p_zeit timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public._nutzer();
  v_zeit timestamptz := least(now(), greatest(coalesce(p_zeit, now()), now() - interval '48 hours'));
  a      public.anlagen;
  r      jsonb := jsonb_build_object('punkte', 0);
  v_erst boolean;
  v_plus integer;
begin
  select * into a from public.anlagen where id = p_anlage;
  if not found then raise exception 'Unbekannte Anlage'; end if;
  if public.distanz_m(p_lat, p_lon, a.lat, a.lon) > 20 then raise exception 'Zum Berühren näher als 20 m herangehen'; end if;
  if not exists (select 1 from public.funde where nutzer = v_uid and anlage = p_anlage) then
    r := public.sammeln(p_anlage, p_lat, p_lon, p_zeit);
  end if;
  v_erst := not exists (select 1 from public.funde where anlage = p_anlage and beruehrt is not null);
  v_plus := 2 + case when v_erst then 3 else 0 end;
  update public.funde set beruehrt = v_zeit, punkte = punkte + v_plus
   where nutzer = v_uid and anlage = p_anlage and beruehrt is null;
  if found then
    r := jsonb_set(r, '{punkte}', to_jsonb(coalesce((r->>'punkte')::int, 0) + v_plus));
  else
    v_erst := false;  -- war schon berührt
  end if;
  return r || jsonb_build_object('beruehrt', true, 'erstberuehrt', v_erst);
end $$;

create or replace function public.mein_stand()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('punkte', coalesce(sum(punkte), 0), 'anlagen', count(*))
    from public.funde where nutzer = auth.uid()
$$;

-- Erster Finder einer Anlage – nur unter Personen, mit denen man eine Gruppe teilt
create or replace function public.entdecker(p_anlage text)
returns table (name text, zeit timestamptz, ich boolean)
language sql stable security definer set search_path = '' as $$
  select p.name, f.zeit, f.nutzer = auth.uid()
    from public.funde f join public.profile p on p.id = f.nutzer
   where f.anlage = p_anlage
     and (f.nutzer = auth.uid() or f.nutzer in (
          select m2.nutzer from public.mitglieder m1
            join public.mitglieder m2 on m2.gruppe = m1.gruppe
           where m1.nutzer = auth.uid()))
   order by f.zeit
   limit 1
$$;

-- Erstentdecker und Erstberührer einer Anlage (wer sie als Erste/r überhaupt gesammelt bzw. berührt hat).
-- Der Name ist sichtbar für einen selbst, für Mitglieder gemeinsamer Gruppen und – wenn die Person in der
-- globalen Rangliste sichtbar ist – für alle; sonst nur „ein anderer Spieler“ (name = null).
create or replace function public.erstfinder(p_anlage text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with sicht as (
    select m2.nutzer from public.mitglieder m1 join public.mitglieder m2 on m2.gruppe = m1.gruppe where m1.nutzer = auth.uid()
  ), e as (
    select f.nutzer, f.zeit from public.funde f where f.anlage = p_anlage order by f.zeit limit 1
  ), b as (
    select f.nutzer, f.beruehrt as zeit from public.funde f where f.anlage = p_anlage and f.beruehrt is not null order by f.beruehrt limit 1
  )
  select jsonb_build_object(
    'entdeckt', (select jsonb_build_object('zeit', e.zeit, 'ich', e.nutzer = auth.uid(),
                   'name', case when e.nutzer = auth.uid() or p.global or e.nutzer in (select nutzer from sicht) then p.name end)
                 from e join public.profile p on p.id = e.nutzer),
    'beruehrt', (select jsonb_build_object('zeit', b.zeit, 'ich', b.nutzer = auth.uid(),
                   'name', case when b.nutzer = auth.uid() or p.global or b.nutzer in (select nutzer from sicht) then p.name end)
                 from b join public.profile p on p.id = b.nutzer))
  where auth.uid() is not null
$$;

-- ---------------------------------------------------------------- Gruppen

create or replace function public.gruppe_erstellen(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public._nutzer();
  zeichen constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- ohne 0/O, 1/I
  v_code text;
  v_zufall bytea;
  v_id   uuid;
begin
  if (select count(*) from public.mitglieder where nutzer = v_uid) >= 20 then
    raise exception 'Höchstens 20 Gruppen pro Person';
  end if;
  loop
    v_zufall := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    select string_agg(substr(zeichen, 1 + get_byte(v_zufall, i) % 32, 1), '' order by i)
      into v_code from generate_series(0, 5) i;
    exit when not exists (select 1 from public.gruppen where code = v_code);
  end loop;
  insert into public.gruppen (name, code, erstellt_von) values (btrim(p_name), v_code, v_uid) returning id into v_id;
  insert into public.mitglieder (gruppe, nutzer) values (v_id, v_uid);
  return jsonb_build_object('id', v_id, 'name', btrim(p_name), 'code', v_code);
end $$;

-- Ein unbekannter Code liefert {"fehler": …} statt einer Exception, damit der
-- Fehlversuch gespeichert bleibt (eine Exception würde ihn zurückrollen).
create or replace function public.gruppe_beitreten(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public._nutzer();
  g     public.gruppen;
begin
  if (select count(*) from public.beitritt_fehler
       where nutzer = v_uid and zeit > now() - interval '1 hour') >= 10 then
    raise exception 'Zu viele falsche Codes – bitte in einer Stunde erneut versuchen';
  end if;
  select * into g from public.gruppen where code = upper(btrim(p_code));
  if not found then
    insert into public.beitritt_fehler (nutzer) values (v_uid);
    return jsonb_build_object('fehler', 'Unbekannter Einladungscode');
  end if;
  if (select count(*) from public.mitglieder where gruppe = g.id) >= 200 then
    raise exception 'Gruppe ist voll';
  end if;
  insert into public.mitglieder (gruppe, nutzer) values (g.id, v_uid) on conflict do nothing;
  return jsonb_build_object('id', g.id, 'name', g.name, 'code', g.code);
end $$;

create or replace function public.gruppe_verlassen(p_gruppe uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public._nutzer();
begin
  delete from public.mitglieder where gruppe = p_gruppe and nutzer = v_uid;
  delete from public.gruppen g where g.id = p_gruppe
     and not exists (select 1 from public.mitglieder m where m.gruppe = g.id);
end $$;

create or replace function public.meine_gruppen()
returns table (id uuid, name text, code text, mitglieder integer)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, g.code,
         (select count(*)::int from public.mitglieder x where x.gruppe = g.id)
    from public.mitglieder m join public.gruppen g on g.id = m.gruppe
   where m.nutzer = auth.uid()
   order by m.beigetreten
$$;

-- Zeitraum [p_seit, p_bis); null = offen. Beides null: Gesamtwertung
drop function if exists public.rangliste(uuid, timestamptz);
drop function if exists public.rangliste(uuid, timestamptz, timestamptz);
create or replace function public.rangliste(p_gruppe uuid, p_seit timestamptz default null, p_bis timestamptz default null)
returns table (name text, punkte bigint, anlagen bigint, modelle bigint, beruehrt bigint, ich boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.mitglieder where gruppe = p_gruppe and nutzer = auth.uid()) then
    raise exception 'Kein Mitglied dieser Gruppe';
  end if;
  return query
    select p.name,
           coalesce(sum(f.punkte), 0)::bigint,
           count(f.anlage),
           count(distinct (a.marke, a.modell)) filter (where a.modell is not null),
           count(f.beruehrt),
           p.id = auth.uid()
      from public.mitglieder m
      join public.profile p on p.id = m.nutzer
      left join public.funde f on f.nutzer = m.nutzer
            and (p_seit is null or f.zeit >= p_seit) and (p_bis is null or f.zeit < p_bis)
      left join public.anlagen a on a.id = f.anlage
     where m.gruppe = p_gruppe
     group by p.id, p.name
     order by 2 desc, 3 desc, p.name;
end $$;

-- Globale Rangliste: alle, die sich freigeschaltet haben (Top 100), dazu immer man selbst
drop function if exists public.rangliste_global(timestamptz, timestamptz);
create or replace function public.rangliste_global(p_seit timestamptz default null, p_bis timestamptz default null)
returns table (platz bigint, name text, punkte bigint, anlagen bigint, modelle bigint, beruehrt bigint, ich boolean, sichtbar boolean)
language sql stable security definer set search_path = '' as $$
  with w as (
    select p.id, p.name, p.global,
           coalesce(sum(f.punkte), 0)::bigint as punkte,
           count(f.anlage) as anlagen,
           count(distinct (a.marke, a.modell)) filter (where a.modell is not null) as modelle,
           count(f.beruehrt) as beruehrt
      from public.profile p
      left join public.funde f on f.nutzer = p.id
            and (p_seit is null or f.zeit >= p_seit) and (p_bis is null or f.zeit < p_bis)
      left join public.anlagen a on a.id = f.anlage
     where auth.uid() is not null and (p.global or p.id = auth.uid())
     group by p.id, p.name, p.global
  ), r as (
    select w.*, rank() over (order by w.punkte desc) as platz,
           row_number() over (order by w.punkte desc, w.anlagen desc, w.name) as nr
      from w where w.punkte > 0 or w.id = auth.uid()
  )
  select r.platz, r.name, r.punkte, r.anlagen, r.modelle, r.beruehrt, r.id = auth.uid(), r.global
    from r where r.nr <= 100 or r.id = auth.uid()
   order by r.nr
$$;

-- Eigene online gewertete Funde – damit das lokale Sammelheft nach einer Anmeldung auf einem neuen
-- Gerät (oder nach gelöschtem Speicher) wiederhergestellt werden kann. Anlagendaten für abgebaute Anlagen.
create or replace function public.meine_funde()
returns table (anlage text, zeit timestamptz, beruehrt timestamptz, erst boolean, erst_b boolean,
               marke text, modell text, kw real, nabe real, ibn date, lat float8, lon float8)
language sql stable security definer set search_path = '' as $$
  select f.anlage, f.zeit, f.beruehrt,
         not exists (select 1 from public.funde e where e.anlage = f.anlage and e.zeit < f.zeit),
         f.beruehrt is not null and not exists (
           select 1 from public.funde e where e.anlage = f.anlage and e.beruehrt < f.beruehrt),
         a.marke, a.modell, a.kw, a.nabe, a.ibn, a.lat, a.lon
    from public.funde f join public.anlagen a on a.id = f.anlage
   where f.nutzer = auth.uid()
$$;

-- Profil eines Spielers: Zahlen, Abzeichen, Hersteller, Raritäten – bewusst ohne Orte und Funddaten.
-- Sichtbar wie in der Rangliste: man selbst, Mitglieder gemeinsamer Gruppen und global sichtbare Spieler.
-- Abzeichen nur, soweit aus den online gewerteten Funden berechenbar (Schlüssel wie ABZEICHEN in app.js).
create or replace function public.spieler_profil(p_name text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ich uuid := public._nutzer();
  p     public.profile;
  r     jsonb;
begin
  select * into p from public.profile where lower(btrim(name)) = lower(btrim(coalesce(p_name, '')));
  if not found or not (p.id = v_ich or p.global or exists (
       select 1 from public.mitglieder m1 join public.mitglieder m2 on m2.gruppe = m1.gruppe
        where m1.nutzer = v_ich and m2.nutzer = p.id)) then
    return jsonb_build_object('fehler', 'Dieses Profil ist für dich nicht sichtbar');
  end if;

  with f as (
    select f.punkte, f.beruehrt, a.marke, a.modell, a.kw, a.nabe, a.ibn, a.selten,
           not exists (select 1 from public.funde e where e.anlage = f.anlage and e.zeit < f.zeit) as erst,
           f.beruehrt is not null and not exists (
             select 1 from public.funde e where e.anlage = f.anlage and e.beruehrt < f.beruehrt) as erst_b
      from public.funde f join public.anlagen a on a.id = f.anlage
     where f.nutzer = p.id
  ), z as (
    select count(*) as anlagen, coalesce(sum(punkte), 0) as punkte,
           count(distinct marke) as hersteller,
           count(distinct (marke, modell)) filter (where modell is not null) as modelle,
           coalesce(sum(kw), 0) as kw, count(beruehrt) as beruehrt,
           coalesce(bool_or(ibn < date '2000-01-01'), false) as alt,
           coalesce(bool_or(nabe >= 160), false) as riese,
           coalesce(bool_or(nabe < 50), false) as zwerg,
           coalesce(bool_or(selten), false) as selten,
           coalesce(bool_or(erst), false) as pionier,
           coalesce(bool_or(erst_b), false) as erstkontakt
      from f
  )
  select jsonb_build_object(
    'name', p.name, 'ich', p.id = v_ich, 'seit', p.erstellt,
    'punkte', z.punkte, 'anlagen', z.anlagen, 'hersteller', z.hersteller, 'modelle', z.modelle,
    'kw', z.kw, 'beruehrt', z.beruehrt,
    'abzeichen', to_jsonb(array_remove(array[
      case when z.anlagen >= 1 then 'erster' end,
      case when z.anlagen >= 10 then 'a10' end,
      case when z.anlagen >= 50 then 'a50' end,
      case when z.anlagen >= 100 then 'a100' end,
      case when z.hersteller >= 3 then 'm3' end,
      case when z.hersteller >= 6 then 'm6' end,
      case when z.modelle >= 10 then 't10' end,
      case when z.modelle >= 25 then 't25' end,
      case when z.alt then 'alt' end,
      case when z.riese then 'riese' end,
      case when z.zwerg then 'zwerg' end,
      case when z.selten then 'selten' end,
      case when z.kw >= 100000 then 'mw100' end,
      case when z.beruehrt >= 1 then 'b1' end,
      case when z.beruehrt >= 10 then 'b10' end,
      case when z.pionier then 'pionier' end,
      case when z.erstkontakt then 'erstkontakt' end
    ], null)),
    'marken', (select coalesce(jsonb_agg(jsonb_build_object('marke', m.marke, 'anlagen', m.n, 'modelle', m.mod)
                                         order by m.n desc, m.marke), '[]'::jsonb)
                 from (select marke, count(*) as n, count(distinct modell) as mod
                         from f where marke is not null group by marke) m),
    'raritaeten', (select coalesce(jsonb_agg(x.t order by x.t), '[]'::jsonb)
                     from (select distinct marke || ' ' || modell as t from f
                            where selten and marke is not null and modell is not null) x)
  ) into r from z;
  return r;
end $$;

-- ---------------------------------------------------------------- Kommentare

-- Kommentare zu einer Anlage; ab 3 Meldungen sieht einen Kommentar nur noch der Verfasser
create or replace function public.kommentare_lesen(p_anlage text)
returns table (id uuid, name text, sterne smallint, text text, zeit timestamptz, ich boolean, gemeldet boolean)
language sql stable security definer set search_path = '' as $$
  select k.id, p.name, k.sterne, k.text, k.zeit, k.nutzer = auth.uid(),
         exists (select 1 from public.meldungen m where m.kommentar = k.id and m.nutzer = auth.uid())
    from public.kommentare k join public.profile p on p.id = k.nutzer
   where k.anlage = p_anlage
     and auth.uid() is not null
     and (k.nutzer = auth.uid() or (select count(*) from public.meldungen m where m.kommentar = k.id) < 3)
     and not exists (select 1 from public.blockiert b where b.nutzer = auth.uid() and b.blockiert = k.nutzer)
   order by k.nutzer = auth.uid() desc, k.zeit desc
   limit 100
$$;

create or replace function public.kommentar_speichern(p_anlage text, p_sterne int, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public._nutzer();
  v_text text := btrim(coalesce(p_text, ''));
begin
  if not exists (select 1 from public.funde where nutzer = v_uid and anlage = p_anlage) then
    raise exception 'Bewerten kannst du nur Anlagen, die du mit deinem Konto gesammelt hast';
  end if;
  if p_sterne is null or p_sterne not between 1 and 5 then raise exception 'Bitte 1 bis 5 Sterne vergeben'; end if;
  if char_length(v_text) > 500 then raise exception 'Höchstens 500 Zeichen'; end if;
  if (select count(*) from public.kommentare where nutzer = v_uid and zeit > now() - interval '24 hours') >= 30 then
    raise exception 'Tageslimit für Kommentare erreicht';
  end if;
  -- Meldungen bleiben beim Bearbeiten erhalten, damit sich ein ausgeblendeter Kommentar nicht freischreiben lässt
  insert into public.kommentare (nutzer, anlage, sterne, text)
  values (v_uid, p_anlage, p_sterne, v_text)
  on conflict (nutzer, anlage) do update set sterne = excluded.sterne, text = excluded.text, zeit = now();
end $$;

create or replace function public.kommentar_loeschen(p_anlage text)
returns void language sql security definer set search_path = '' as $$
  delete from public.kommentare where nutzer = auth.uid() and anlage = p_anlage
$$;

create or replace function public.kommentar_melden(p_kommentar uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public._nutzer();
begin
  if exists (select 1 from public.kommentare where id = p_kommentar and nutzer = v_uid) then
    raise exception 'Eigene Kommentare kannst du löschen statt melden';
  end if;
  insert into public.meldungen (kommentar, nutzer) values (p_kommentar, v_uid) on conflict do nothing;
end $$;

-- Verfasser eines Kommentars blockieren (ohne dessen Konto-ID preiszugeben)
create or replace function public.nutzer_blockieren(p_kommentar uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public._nutzer();
  v_wer uuid;
begin
  select nutzer into v_wer from public.kommentare where id = p_kommentar;
  if v_wer is null then raise exception 'Kommentar nicht gefunden'; end if;
  if v_wer = v_uid then raise exception 'Du kannst dich nicht selbst blockieren'; end if;
  if (select count(*) from public.blockiert where nutzer = v_uid) >= 500 then raise exception 'Höchstens 500 blockierte Spieler'; end if;
  insert into public.blockiert (nutzer, blockiert) values (v_uid, v_wer) on conflict do nothing;
end $$;

create or replace function public.blockierte_lesen()
returns table (id uuid, name text, zeit timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.id, p.name, b.zeit
    from public.blockiert b join public.profile p on p.id = b.blockiert
   where b.nutzer = auth.uid()
   order by b.zeit desc
$$;

create or replace function public.entblocken(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.blockiert where id = p_id and nutzer = auth.uid()
$$;

-- ---------------------------------------------------------------- Admin (nur für Konten in public.admins)

create or replace function public._admin()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null or not exists (select 1 from public.admins where nutzer = v) then raise exception 'Keine Berechtigung'; end if;
  return v;
end $$;

create or replace function public.admin_ist()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where nutzer = auth.uid())
$$;

create or replace function public.admin_uebersicht()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._admin();
  return jsonb_build_object(
    'spieler',        (select count(*) from public.profile),
    'neu7',           (select count(*) from public.profile where erstellt > now() - interval '7 days'),
    'aktiv7',         (select count(distinct nutzer) from public.funde where zeit > now() - interval '7 days'),
    'aktiv30',        (select count(distinct nutzer) from public.funde where zeit > now() - interval '30 days'),
    'global',         (select count(*) from public.profile where global),
    'funde',          (select count(*) from public.funde),
    'funde7',         (select count(*) from public.funde where zeit > now() - interval '7 days'),
    'beruehrt',       (select count(*) from public.funde where beruehrt is not null),
    'kommentare',     (select count(*) from public.kommentare),
    'gruppen',        (select count(*) from public.gruppen),
    'offen',          (select count(distinct kommentar) from public.meldungen),
    'ausgeblendet',   (select count(*) from (select kommentar from public.meldungen group by kommentar having count(*) >= 3) x),
    'aelteste_meldung', (select min(zeit) from public.meldungen)
  );
end $$;

-- Gemeldete Kommentare, älteste Meldung zuerst
create or replace function public.admin_meldungen()
returns table (id uuid, verfasser uuid, name text, anlage text, sterne smallint, text text, zeit timestamptz,
               meldungen bigint, erste_meldung timestamptz, ausgeblendet boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._admin();
  return query
    select k.id, k.nutzer, p.name, k.anlage, k.sterne, k.text, k.zeit,
           count(m.nutzer), min(m.zeit), count(m.nutzer) >= 3
      from public.kommentare k
      join public.profile p on p.id = k.nutzer
      join public.meldungen m on m.kommentar = k.id
     group by k.id, p.name
     order by min(m.zeit);
end $$;

-- Meldungen verwerfen: Kommentar ist in Ordnung und wird wieder für alle sichtbar
create or replace function public.admin_meldung_verwerfen(p_kommentar uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._admin();
  delete from public.meldungen where kommentar = p_kommentar;
  update public.kommentare set geprueft = now() where id = p_kommentar;
end $$;

create or replace function public.admin_kommentar_loeschen(p_kommentar uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._admin();
  delete from public.kommentare where id = p_kommentar;
end $$;

-- Spielerliste mit Aktivität; p_suche filtert nach Namen
create or replace function public.admin_spieler(p_suche text default null)
returns table (id uuid, name text, erstellt timestamptz, global boolean, funde bigint, zuletzt timestamptz,
               kommentare bigint, gemeldet bigint, admin boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._admin();
  return query
    select p.id, p.name, p.erstellt, p.global,
           (select count(*) from public.funde f where f.nutzer = p.id),
           (select max(f.zeit) from public.funde f where f.nutzer = p.id),
           (select count(*) from public.kommentare k where k.nutzer = p.id),
           (select count(*) from public.meldungen m join public.kommentare k on k.id = m.kommentar where k.nutzer = p.id),
           exists (select 1 from public.admins a where a.nutzer = p.id)
      from public.profile p
     where p_suche is null or p.name ilike '%' || p_suche || '%'
     order by p.erstellt desc
     limit 200;
end $$;

-- Spieler endgültig löschen (Profil, Funde, Bewertungen, Mitgliedschaften folgen per CASCADE)
create or replace function public.admin_spieler_loeschen(p_nutzer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._admin();
begin
  if p_nutzer = v_admin then raise exception 'Das eigene Konto bitte über „Konto löschen“ in der App löschen'; end if;
  if exists (select 1 from public.admins where nutzer = p_nutzer) then raise exception 'Admin-Konten zuerst aus public.admins entfernen'; end if;
  delete from auth.users where id = p_nutzer;
  delete from public.gruppen g where not exists (select 1 from public.mitglieder m where m.gruppe = g.id);
end $$;

-- ---------------------------------------------------------------- Konto löschen (DSGVO)

create or replace function public.konto_loeschen()
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  delete from auth.users where id = v_uid;  -- Profil, Funde und Mitgliedschaften folgen per CASCADE
  delete from public.gruppen g where not exists (select 1 from public.mitglieder m where m.gruppe = g.id);
end $$;

-- ---------------------------------------------------------------- Passwort & Konto wiederherstellen
-- Konten sind anonym und hängen am Browser-/App-Speicher. Wer ein Passwort festlegt, kann sich später
-- in einer neuen (anonymen) Sitzung mit Spielername + Passwort anmelden: Alle Daten des alten Kontos
-- wandern dann ins neue, das alte wird gelöscht.

create or replace function public.passwort_setzen(p_passwort text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public._nutzer();
begin
  if char_length(coalesce(p_passwort, '')) < 6 then raise exception 'Das Passwort braucht mindestens 6 Zeichen'; end if;
  if char_length(p_passwort) > 72 then raise exception 'Das Passwort ist zu lang (höchstens 72 Zeichen)'; end if;
  insert into public.passwoerter (nutzer, hash) values (v_uid, extensions.crypt(p_passwort, extensions.gen_salt('bf', 10)))
  on conflict (nutzer) do update set hash = excluded.hash, geaendert = now();
end $$;

create or replace function public.hat_passwort()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.passwoerter where nutzer = auth.uid())
$$;

create or replace function public.konto_uebernehmen(p_name text, p_passwort text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_neu  uuid := auth.uid();
  v_key  text := lower(btrim(coalesce(p_name, '')));
  alt    record;
begin
  if v_neu is null then raise exception 'Nicht angemeldet'; end if;
  if (select count(*) from public.login_fehler where name = v_key and zeit > now() - interval '15 minutes') >= 5
     or (select count(*) from public.login_fehler where nutzer = v_neu and zeit > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('fehler', 'Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen');
  end if;

  select p.id, p.name, p.global, p.erstellt, w.hash into alt
    from public.profile p join public.passwoerter w on w.nutzer = p.id
   where lower(btrim(p.name)) = v_key;
  if not found or alt.hash <> extensions.crypt(coalesce(p_passwort, ''), alt.hash) then
    insert into public.login_fehler (name, nutzer) values (v_key, v_neu);
    return jsonb_build_object('fehler', 'Spielername oder Passwort falsch');
  end if;
  if alt.id = v_neu then
    return jsonb_build_object('id', alt.id, 'name', alt.name, 'global', alt.global);
  end if;

  -- Profil für die neue Sitzung (vorläufiger Name, falls hier noch keins existiert)
  insert into public.profile (id, name) values (v_neu, '~' || left(replace(v_neu::text, '-', ''), 20))
  on conflict (id) do nothing;

  -- Funde: doppelte Anlagen zusammenführen (früheste Zeit, höhere Punkte), Rest umhängen
  update public.funde n
     set zeit = least(n.zeit, a.zeit), punkte = greatest(n.punkte, a.punkte), beruehrt = least(n.beruehrt, a.beruehrt)
    from public.funde a
   where a.nutzer = alt.id and n.nutzer = v_neu and n.anlage = a.anlage;
  update public.funde a set nutzer = v_neu
   where a.nutzer = alt.id and not exists (select 1 from public.funde n where n.nutzer = v_neu and n.anlage = a.anlage);

  update public.mitglieder a set nutzer = v_neu
   where a.nutzer = alt.id and not exists (select 1 from public.mitglieder n where n.nutzer = v_neu and n.gruppe = a.gruppe);
  update public.kommentare a set nutzer = v_neu
   where a.nutzer = alt.id and not exists (select 1 from public.kommentare n where n.nutzer = v_neu and n.anlage = a.anlage);
  update public.meldungen a set nutzer = v_neu
   where a.nutzer = alt.id and not exists (select 1 from public.meldungen n where n.nutzer = v_neu and n.kommentar = a.kommentar);
  update public.blockiert a set nutzer = v_neu
   where a.nutzer = alt.id and not exists (select 1 from public.blockiert n where n.nutzer = v_neu and n.blockiert = a.blockiert);
  update public.blockiert a set blockiert = v_neu
   where a.blockiert = alt.id and not exists (select 1 from public.blockiert n where n.blockiert = v_neu and n.nutzer = a.nutzer);
  delete from public.blockiert where nutzer = blockiert;
  update public.gruppen set erstellt_von = v_neu where erstellt_von = alt.id;
  update public.admins a set nutzer = v_neu
   where a.nutzer = alt.id and not exists (select 1 from public.admins n where n.nutzer = v_neu);
  delete from public.passwoerter where nutzer = v_neu;
  update public.passwoerter set nutzer = v_neu where nutzer = alt.id;

  -- Altes Konto löschen (übrig gebliebene Doppelungen folgen per CASCADE), dann Name übernehmen
  delete from auth.users where id = alt.id;
  update public.profile set name = alt.name, global = alt.global, erstellt = least(erstellt, alt.erstellt) where id = v_neu;
  delete from public.login_fehler where name = v_key;
  return jsonb_build_object('id', v_neu, 'name', alt.name, 'global', alt.global);
end $$;

-- ---------------------------------------------------------------- Aufräumen (nächtlich per pg_cron)
-- Anonyme Konten ohne Spielernamen (abgebrochene oder automatisierte Anmeldungen) nach einem Tag löschen,
-- ebenso alte Fehlversuche.

create or replace function public.aufraeumen()
returns void language sql security definer set search_path = '' as $$
  delete from auth.users u
   where u.is_anonymous and u.created_at < now() - interval '1 day'
     and not exists (select 1 from public.profile p where p.id = u.id);
  delete from public.beitritt_fehler where zeit < now() - interval '1 day';
  delete from public.login_fehler where zeit < now() - interval '1 day';
  delete from public.gruppen g where not exists (select 1 from public.mitglieder m where m.gruppe = g.id);
$$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('windsammler-aufraeumen', '17 3 * * *', 'select public.aufraeumen()');
exception when others then
  raise notice 'pg_cron nicht verfügbar – Aufräumen bitte manuell planen: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- Rechte

revoke all on all functions in schema public from public, anon;
revoke all on function public.distanz_m(float8, float8, float8, float8), public._nutzer(), public._admin(), public.aufraeumen() from authenticated;
grant execute on function
  public.sammeln(text, float8, float8, timestamptz),
  public.mein_stand(),
  public.entdecker(text),
  public.erstfinder(text),
  public.gruppe_erstellen(text),
  public.gruppe_beitreten(text),
  public.gruppe_verlassen(uuid),
  public.meine_gruppen(),
  public.rangliste(uuid, timestamptz, timestamptz),
  public.rangliste_global(timestamptz, timestamptz),
  public.beruehren(text, float8, float8, timestamptz),
  public.kommentare_lesen(text),
  public.kommentar_speichern(text, int, text),
  public.kommentar_loeschen(text),
  public.kommentar_melden(uuid),
  public.nutzer_blockieren(uuid),
  public.blockierte_lesen(),
  public.entblocken(uuid),
  public.admin_ist(),
  public.admin_uebersicht(),
  public.admin_meldungen(),
  public.admin_meldung_verwerfen(uuid),
  public.admin_kommentar_loeschen(uuid),
  public.admin_spieler(text),
  public.admin_spieler_loeschen(uuid),
  public.konto_loeschen(),
  public.passwort_setzen(text),
  public.hat_passwort(),
  public.konto_uebernehmen(text, text),
  public.spieler_profil(text),
  public.meine_funde()
to authenticated;
