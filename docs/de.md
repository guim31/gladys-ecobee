# ecobee

## 1. Überblick

Diese Integration bringt deine **ecobee-Thermostate** und ihre **SmartSensoren** (Raumsensoren)
in Gladys: Temperatur, Luftfeuchtigkeit, Sollwerte für Heizen und Kühlen, Modus,
Komforteinstellung (Zuhause / Abwesend / Schlafen), Halte-Einstellungen, was die Anlage gerade
tut, und Anwesenheit. Aus Gladys änderst du Sollwert, Modus, Lüfter und Komforteinstellung,
setzt das Programm fort und startest oder beendest einen Urlaub aus einer Szene.

Die Integration arbeitet über die ecobee-Cloud, wie die ecobee-App: Das Thermostat braucht eine
Internetverbindung.

> Ohne die Hardware entwickelt: Rückmeldungen sind willkommen. Diese Integration ist nicht mit
> ecobee verbunden.

## 2. Voraussetzungen

- Gladys Assistant **5.2.0** oder neuer.
- Ein ecobee-Konto (das der ecobee-App) mit mindestens einem Thermostat.
- Nutzt dein Konto die Bestätigung in zwei Schritten: deine Authentifizierungs-App oder dein
  Telefon für den SMS-Code. Push-Benachrichtigungen und E-Mail-Links werden nicht unterstützt.
- Optional: ein **Entwickler-API-Schlüssel**, falls du noch einen hast (ecobee vergibt seit 2024
  keine mehr).

## 3. Konfiguration

Installiere die Integration aus dem Integrations-Store von Gladys und öffne ihren Reiter
**Konfiguration**.

**Anmeldung mit deinem ecobee-Konto (empfohlen)**

1. Gib die **E-Mail-Adresse** und das **Passwort** der ecobee-App ein und speichere.
2. Ohne Bestätigung in zwei Schritten wird der Status grün und die Thermostate erscheinen im
   Reiter **Erkennung**.
3. Mit Bestätigung in zwei Schritten verlangt der Status den Code: Starte die Aktion
   **Bestätigungscode eingeben** mit dem 6-stelligen Code deiner Authentifizierungs-App oder der
   SMS, die ecobee gerade geschickt hat (innerhalb von 10 Minuten).

Die Integration behält dann eine Sitzung (Erneuerungs-Token) in ihrem Volume `/data` und erneuert
sie selbst. Das Passwort bleibt in der Konfiguration von Gladys; es wird nur erneut genutzt, wenn
ecobee die Sitzung beendet. **Anmelden und testen** liest die Thermostate und meldet, wie viele
gefunden wurden. **Abmelden** löscht die gespeicherte Sitzung.

**Mit einem Entwickler-API-Schlüssel (optional)**

Gib den Schlüssel unter **API-Schlüssel** ein und speichere (er ersetzt E-Mail und Passwort).
Starte **PIN anfordern**: Öffne auf ecobee.com **My Apps**, **Add application**, und gib die PIN
innerhalb ihrer Gültigkeit ein. Die Integration erkennt die Freigabe selbst.

**Einstellungen**

- **Temperatureinheit**: die Einheit der Funktionen: die des Thermostats (Standard), Celsius oder
  Fahrenheit. Gladys rechnet die Messwerte auch in die bevorzugte Einheit jedes Benutzers um.
- **Änderungen aus Gladys halten**: Ein aus Gladys geänderter Sollwert oder eine
  Komforteinstellung ist ein _Halten_, wie in der ecobee-App. Standardmäßig gilt es **bis zur
  nächsten Programmänderung**; du kannst bis zur nächsten Änderung, 2 Stunden, 4 Stunden oder die
  Halte-Einstellung des Thermostats wählen.
- **Abfrageintervall**: wie oft ecobee abgefragt wird, mindestens 3 Minuten.
- **Sprache der Funktionsnamen**: die Namen, die die Funktionen beim Hinzufügen eines Geräts
  bekommen.

Füge dann die Geräte im Reiter **Erkennung** hinzu.

## 4. Geräte

**Ein Gerät pro Thermostat**

| Funktion                     | Bedeutung                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| Temperatur, Luftfeuchtigkeit | Innenmesswerte des Thermostats                                                           |
| Sollwert Heizen              | Ziel beim Heizen (nur wenn das Thermostat eine Heizung steuert)                          |
| Sollwert Kühlen              | Ziel beim Kühlen (nur wenn es eine Kühlung steuert)                                      |
| Modus                        | aus, Heizen, Kühlen, Auto (je nach Anlage)                                               |
| Nur Zusatzheizung            | nur Wärmepumpen: die Zusatzheizung heizt allein (Notheizung)                             |
| Betriebszustand              | inaktiv, heizt, kühlt                                                                    |
| Lüfter dauerhaft an          | an: der Lüfter läuft ständig; aus: automatisch                                           |
| Lüfter läuft                 | der Lüfter läuft gerade                                                                  |
| Komforteinstellung           | Zeitplan (dem Programm folgen), Zuhause, Abwesend, Schlafen — Schreiben setzt ein Halten |
| Aktuelle Komforteinstellung  | der Name der aktiven Komforteinstellung, auch selbst angelegte                           |
| Halten                       | was gerade gilt: Zeitplan, gehalten bis zu einer Uhrzeit, dauerhaft, Urlaub              |
| Anwesenheit                  | der Anwesenheitssensor des Thermostats (nicht beim ecobee3 lite)                         |

**Zeitplan** (Wert 0) auf die Komforteinstellung zu schreiben setzt das Programm fort: Alle
Halte-Einstellungen werden aufgehoben, ebenso ein laufender Urlaub. Im Auto-Modus bleibt der
Sollwert Kühlen mindestens um den Mindestabstand des Thermostats über dem Sollwert Heizen.

**Ein Gerät pro Raumsensor** (SmartSensor): Temperatur und Anwesenheit.

Die Funktionen des Thermostats nutzen die Thermostat-Kategorie des Kerns: Das **Thermostat** von
Gladys 5.2 kann ein ecobee als _externes_ Thermostat steuern (wähle den Sollwert Heizen als Ziel
und den Modus als Modus-Funktion).

## 5. Dashboard-Widget

Füge das Widget **ecobee-Thermostat** hinzu und wähle ein Thermostat. Es zeigt Temperatur,
Sollwert(e) und Luftfeuchtigkeit als Live-Kacheln, den Modus, was läuft, die Komforteinstellung
und das Halten, und vier Schaltflächen:

- **Senken** / **Erhöhen**: ein Schritt des Sollwerts (0,5 °C oder 1 °F); im Auto-Modus bewegen
  sich beide Sollwerte gemeinsam. Ausgeblendet, wenn das Thermostat aus ist.
- **Modus**: die Liste der Modi des Thermostats.
- **Komfort**: Zeitplan, Zuhause, Abwesend, Schlafen.

## 6. Szenen-Auslöser

- **ecobee: Anwesenheit erkannt** (`home_occupied`): Bei einem Thermostat (es und seine Sensoren)
  war niemand erkannt, jetzt jemand. Variablen: Name des Thermostats, Sensoren mit Anwesenheit.
- **ecobee: niemand mehr erkannt** (`home_vacant`): Kein Sensor des Thermostats erkennt noch
  jemanden.
- **ecobee: neue Warnung** (`alert`): Das Thermostat meldet eine Warnung oder Erinnerung
  (Filterwechsel, Wartung, Temperatur außerhalb des Bereichs…). Variablen: Name des Thermostats,
  Text, Art.

Die Anwesenheit jedes Sensors ist auch eine Funktion: Nutze den üblichen Auslöser „Gerätewert“
für einen einzelnen Raum. Diese Auslöser ergänzen, was eine einzelne Funktion nicht sagt: das
ganze Zuhause.

## 7. Szenen-Aktionen

- **ecobee: Programm fortsetzen** (`resume_program`): hebt alle Halte-Einstellungen und den
  laufenden Urlaub auf.
- **ecobee: Komforteinstellung wählen** (`set_comfort`): hält Zuhause, Abwesend oder Schlafen für
  die gewählte Dauer (die der Konfiguration, bis zur nächsten Programmänderung, bis zur nächsten
  Änderung, 2 oder 4 Stunden).
- **ecobee: Urlaub starten** (`start_vacation`): startet jetzt einen ecobee-Urlaub für eine Anzahl
  Tage; ohne Sollwerte gelten die von Abwesend. Ausgabe: das Enddatum.
- **ecobee: Urlaub abbrechen** (`cancel_vacation`): löscht den laufenden und geplanten Urlaub.

Sollwert, Modus und Lüfter stellst du mit der Kern-Aktion „Gerät steuern“ ein. Ein in einer
Aktion gewählter Raumsensor steht für sein Thermostat.

## 8. Beispielszenen

- **Alle sind weg**: Wenn die Alarmanlage scharf geschaltet wird, starte _Komforteinstellung
  wählen_ Abwesend, bis zur nächsten Änderung; beim Unscharfschalten _Programm fortsetzen_.
- **Filter-Erinnerung**: Bei _neue Warnung_ eine Nachricht „{{triggerEvent.data.text}}“ senden.
- **Fenster offen**: Meldet ein Öffnungssensor seit 5 Minuten offen, setze den **Modus** auf aus;
  beim Schließen wieder auf Heizen.
- **Lange Reise**: Starte aus dem Kalender _Urlaub starten_ für 10 Tage.

## 9. Aktualisierung und API-Grenzen

ecobee bittet die Nutzer seiner API, die Thermostate nicht öfter als **alle 3 Minuten** abzufragen.
Die Integration liest alle deine Thermostate in einer Anfrage pro _Abfrageintervall_ (standardmäßig
3 Minuten), dazu eine Abfrage einige Sekunden nach einem Befehl, um seine Wirkung zu zeigen. Nur
geänderte Werte gehen an Gladys, und jeder Wert mindestens alle 6 Stunden. Die Integration
aktualisiert sich selbst und hängt nicht von der Abfrage durch Gladys ab.

## 10. Fehlerbehebung

- **„ecobee hat die E-Mail-Adresse oder das Passwort abgelehnt“**: Prüfe sie in der ecobee-App;
  die Integration wiederholt ein abgelehntes Passwort nie von selbst, speichere die Konfiguration
  erneut.
- **Der Status verlangt einen Bestätigungscode**: Starte _Bestätigungscode eingeben_. Ein
  SMS-Code gilt etwa 10 Minuten; danach löst die Aktion eine neue SMS aus.
- **„ecobee verlangt einen Schritt im Browser“**: Melde dich einmal auf ecobee.com an (neue
  Nutzungsbedingungen…) und speichere die Konfiguration erneut.
- **„ecobee antwortet gerade nicht“**: Ausfall des Internets oder von ecobee; die Integration
  versucht es in jedem Abfrageintervall erneut.
- **Ein Thermostat ist offline**: Es hat die Verbindung zu ecobee verloren; seine letzten Werte
  bleiben, Befehle werden abgelehnt, bis es zurück ist.
- Protokolle: Die Integration schreibt ihre Anmeldung und Probleme einmal; `LOG_LEVEL=debug`
  zeigt jede Abfrage.

## 11. Einschränkungen

- Die Anmeldung mit Konto nutzt dieselbe Anmeldeseite wie das ecobee-Webportal, wie Home
  Assistant: Ändert ecobee sie, kann die Anmeldung bis zu einem Update ausfallen.
- Die Bestätigung in zwei Schritten per Push-Benachrichtigung oder E-Mail-Link wird nicht
  unterstützt.
- Abfragen erfolgen höchstens alle 3 Minuten: Anwesenheit und Betriebszustand sind nicht sofort
  aktuell.
- Nicht unterstützt: Befeuchter, Entfeuchter und Lüftungsanlage, die Sensoren einer
  Komforteinstellung, Luftqualität, Wetter und das Bearbeiten des Thermostat-Programms.
- Die Funktionsnamen werden beim Hinzufügen eines Geräts zu Gladys festgelegt.
- Ohne die Hardware und ohne ecobee-Konto entwickelt: nur mit veröffentlichten API-Antworten
  getestet. Rückmeldungen sind willkommen.
