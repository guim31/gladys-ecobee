// -----------------------------------------------------------------------------
// Every text the integration shows, in the four languages of the Gladys
// interface (en, fr, de, es). German says "du", Spanish says "usted", like
// the rest of guim31's integrations. Brands (ecobee, Gladys) are not
// translated; the words follow the Gladys interface (front/src/config/i18n).
//
//   - TEXT     : fixed texts (connection status, widget labels, action results);
//   - MESSAGES : texts built from a value;
//   - NAMES    : the feature names, in the language of the configuration
//                (fixed when the device is created in Gladys);
//   - LABELS   : the option labels of the mode and preset features.
//
// test/i18n.test.js checks that every entry carries the four languages, and
// that no other source file writes a multi-language text.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

export { LANGUAGES };

export const TEXT = {
  // Connection status (Configuration screen)
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  notConfigured: {
    en: 'Enter the email and password of your ecobee account, then save.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte ecobee, puis enregistrez.',
    de: 'Gib die E-Mail-Adresse und das Passwort deines ecobee-Kontos ein und speichere.',
    es: 'Introduzca el correo electrónico y la contraseña de su cuenta ecobee y guarde.',
  },
  mfaOtp: {
    en: 'ecobee asks for the code of your authenticator app: enter it with the “Enter the verification code” action.',
    fr: 'ecobee demande le code de votre application d’authentification : saisissez-le avec l’action « Saisir le code de vérification ».',
    de: 'ecobee verlangt den Code deiner Authentifizierungs-App: Gib ihn mit der Aktion „Bestätigungscode eingeben“ ein.',
    es: 'ecobee pide el código de su aplicación de autenticación: introdúzcalo con la acción «Introducir el código de verificación».',
  },
  mfaSms: {
    en: 'ecobee sent a code by SMS: enter it with the “Enter the verification code” action within 10 minutes.',
    fr: 'ecobee a envoyé un code par SMS : saisissez-le avec l’action « Saisir le code de vérification » dans les 10 minutes.',
    de: 'ecobee hat einen Code per SMS geschickt: Gib ihn innerhalb von 10 Minuten mit der Aktion „Bestätigungscode eingeben“ ein.',
    es: 'ecobee ha enviado un código por SMS: introdúzcalo con la acción «Introducir el código de verificación» en 10 minutos.',
  },
  credentialsRefused: {
    en: 'ecobee refused the email or the password. Check them, then save again.',
    fr: 'ecobee a refusé l’e-mail ou le mot de passe. Vérifiez-les, puis enregistrez à nouveau.',
    de: 'ecobee hat die E-Mail-Adresse oder das Passwort abgelehnt. Prüfe sie und speichere erneut.',
    es: 'ecobee ha rechazado el correo electrónico o la contraseña. Compruébelos y vuelva a guardar.',
  },
  mfaUnsupported: {
    en: 'Your account asks for a second factor other than a code (push, email): only authenticator app and SMS codes are supported.',
    fr: 'Votre compte demande un second facteur autre qu’un code (notification, e-mail) : seuls les codes d’application et par SMS sont pris en charge.',
    de: 'Dein Konto verlangt einen zweiten Faktor ohne Code (Push, E-Mail): Unterstützt werden nur Codes aus einer App oder per SMS.',
    es: 'Su cuenta pide un segundo factor que no es un código (notificación, correo): solo se admiten códigos de aplicación o SMS.',
  },
  promptNeeded: {
    en: 'ecobee asks for a step in a browser (new terms of use…): sign in once on ecobee.com, then save the configuration again.',
    fr: 'ecobee demande une étape dans un navigateur (nouvelles conditions…) : connectez-vous une fois sur ecobee.com, puis enregistrez à nouveau.',
    de: 'ecobee verlangt einen Schritt im Browser (neue Nutzungsbedingungen…): Melde dich einmal auf ecobee.com an und speichere dann erneut.',
    es: 'ecobee pide un paso en un navegador (nuevas condiciones…): inicie sesión una vez en ecobee.com y vuelva a guardar.',
  },
  apiKeyRefused: {
    en: 'ecobee refused the developer API key. Check it, or leave it empty to sign in with the email and password.',
    fr: 'ecobee a refusé la clé d’API développeur. Vérifiez-la, ou laissez-la vide pour vous connecter par e-mail et mot de passe.',
    de: 'ecobee hat den Entwickler-API-Schlüssel abgelehnt. Prüfe ihn oder lass ihn leer, um dich mit E-Mail und Passwort anzumelden.',
    es: 'ecobee ha rechazado la clave de API de desarrollador. Compruébela, o déjela vacía para iniciar sesión con correo y contraseña.',
  },
  pinNeeded: {
    en: 'Get a PIN with the “Get a PIN” action, then enter it on ecobee.com, under My Apps.',
    fr: 'Obtenez un code PIN avec l’action « Obtenir un code PIN », puis saisissez-le sur ecobee.com, dans « My Apps ».',
    de: 'Hol dir mit der Aktion „PIN anfordern“ eine PIN und gib sie auf ecobee.com unter „My Apps“ ein.',
    es: 'Obtenga un PIN con la acción «Obtener un PIN» e introdúzcalo en ecobee.com, en «My Apps».',
  },
  unreachable: {
    en: 'ecobee does not answer right now: the integration keeps trying.',
    fr: 'ecobee ne répond pas pour le moment : l’intégration réessaie.',
    de: 'ecobee antwortet gerade nicht: Die Integration versucht es weiter.',
    es: 'ecobee no responde en este momento: la integración sigue intentándolo.',
  },
  noThermostat: {
    en: 'Signed in, but this ecobee account has no thermostat.',
    fr: 'Connecté, mais ce compte ecobee n’a aucun thermostat.',
    de: 'Angemeldet, aber dieses ecobee-Konto hat kein Thermostat.',
    es: 'Sesión iniciada, pero esta cuenta ecobee no tiene ningún termostato.',
  },

  // Results of the actions of the Configuration screen
  mfaCodeRefused: {
    en: 'ecobee refused the code. Check it and try again.',
    fr: 'ecobee a refusé le code. Vérifiez-le et réessayez.',
    de: 'ecobee hat den Code abgelehnt. Prüfe ihn und versuche es erneut.',
    es: 'ecobee ha rechazado el código. Compruébelo e inténtelo de nuevo.',
  },
  mfaNewSms: {
    en: 'The previous sign-in expired: ecobee sent a new SMS code, enter that one.',
    fr: 'La connexion précédente a expiré : ecobee a envoyé un nouveau code par SMS, saisissez celui-là.',
    de: 'Die vorherige Anmeldung ist abgelaufen: ecobee hat einen neuen SMS-Code geschickt, gib diesen ein.',
    es: 'El inicio de sesión anterior ha caducado: ecobee ha enviado un nuevo código por SMS, introduzca ese.',
  },
  mfaCodeMissing: {
    en: 'Enter the 6-digit code.',
    fr: 'Saisissez le code à 6 chiffres.',
    de: 'Gib den 6-stelligen Code ein.',
    es: 'Introduzca el código de 6 dígitos.',
  },
  pinExpired: {
    en: 'The PIN expired before it was entered on ecobee.com: get a new one.',
    fr: 'Le code PIN a expiré avant d’être saisi sur ecobee.com : demandez-en un nouveau.',
    de: 'Die PIN ist abgelaufen, bevor sie auf ecobee.com eingegeben wurde: Fordere eine neue an.',
    es: 'El PIN ha caducado antes de introducirse en ecobee.com: solicite uno nuevo.',
  },
  apiKeyOnly: {
    en: 'This action is for a developer API key: enter one in the configuration first.',
    fr: 'Cette action sert à une clé d’API développeur : renseignez-en une d’abord dans la configuration.',
    de: 'Diese Aktion ist für einen Entwickler-API-Schlüssel: Gib zuerst einen in der Konfiguration ein.',
    es: 'Esta acción es para una clave de API de desarrollador: introduzca una primero en la configuración.',
  },
  accountOnly: {
    en: 'This action is for the account sign-in: enter the email and password, and leave the API key empty.',
    fr: 'Cette action sert à la connexion par compte : renseignez l’e-mail et le mot de passe, et laissez la clé d’API vide.',
    de: 'Diese Aktion ist für die Anmeldung mit Konto: Gib E-Mail und Passwort ein und lass den API-Schlüssel leer.',
    es: 'Esta acción es para el inicio de sesión con cuenta: introduzca correo y contraseña y deje vacía la clave de API.',
  },
  signedOut: {
    en: 'Signed out: the ecobee session stored by the integration is deleted.',
    fr: 'Déconnecté : la session ecobee conservée par l’intégration est supprimée.',
    de: 'Abgemeldet: Die von der Integration gespeicherte ecobee-Sitzung ist gelöscht.',
    es: 'Sesión cerrada: se ha eliminado la sesión de ecobee guardada por la integración.',
  },

  // Errors of the commands, scene actions and widget buttons
  notSignedIn: {
    en: 'Not signed in to ecobee: check the integration configuration.',
    fr: 'Non connecté à ecobee : vérifiez la configuration de l’intégration.',
    de: 'Nicht bei ecobee angemeldet: Prüfe die Konfiguration der Integration.',
    es: 'Sin sesión en ecobee: compruebe la configuración de la integración.',
  },
  thermostatNotFound: {
    en: 'This ecobee thermostat is unknown: choose a thermostat of the integration.',
    fr: 'Ce thermostat ecobee est inconnu : choisissez un thermostat de l’intégration.',
    de: 'Dieses ecobee-Thermostat ist unbekannt: Wähle ein Thermostat der Integration.',
    es: 'Este termostato ecobee es desconocido: elija un termostato de la integración.',
  },
  thermostatOffline: {
    en: 'The thermostat is offline from ecobee: the command was not sent.',
    fr: 'Le thermostat est déconnecté d’ecobee : la commande n’a pas été envoyée.',
    de: 'Das Thermostat ist nicht mit ecobee verbunden: Der Befehl wurde nicht gesendet.',
    es: 'El termostato está desconectado de ecobee: no se ha enviado la orden.',
  },
  modeUnsupported: {
    en: 'This thermostat does not drive this kind of equipment.',
    fr: 'Ce thermostat ne pilote pas ce type d’équipement.',
    de: 'Dieses Thermostat steuert diese Art von Anlage nicht.',
    es: 'Este termostato no controla este tipo de equipo.',
  },
  thermostatIsOff: {
    en: 'The thermostat is off: choose a mode first.',
    fr: 'Le thermostat est arrêté : choisissez d’abord un mode.',
    de: 'Das Thermostat ist aus: Wähle zuerst einen Modus.',
    es: 'El termostato está apagado: elija primero un modo.',
  },
  commandFailed: {
    en: 'ecobee refused the command, check the integration logs.',
    fr: 'ecobee a refusé la commande, consultez les journaux de l’intégration.',
    de: 'ecobee hat den Befehl abgelehnt, sieh dir die Protokolle der Integration an.',
    es: 'ecobee ha rechazado la orden, consulte los registros de la integración.',
  },
  noVacation: {
    en: 'No vacation is planned on this thermostat.',
    fr: 'Aucunes vacances ne sont prévues sur ce thermostat.',
    de: 'Auf diesem Thermostat ist kein Urlaub geplant.',
    es: 'No hay vacaciones previstas en este termostato.',
  },
  climateMissing: {
    en: 'This comfort setting does not exist on this thermostat.',
    fr: 'Ce mode confort n’existe pas sur ce thermostat.',
    de: 'Diese Komforteinstellung gibt es auf diesem Thermostat nicht.',
    es: 'Este ajuste de confort no existe en este termostato.',
  },

  // Widget
  pickThermostat: {
    en: 'Choose a thermostat in the widget settings.',
    fr: 'Choisissez un thermostat dans les réglages du widget.',
    de: 'Wähle ein Thermostat in den Einstellungen des Widgets.',
    es: 'Elija un termostato en los ajustes del widget.',
  },
  waiting: {
    en: 'Waiting for the first reading from ecobee.',
    fr: 'En attente de la première lecture ecobee.',
    de: 'Warte auf die erste Abfrage bei ecobee.',
    es: 'Esperando la primera lectura de ecobee.',
  },
  temperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  setpoint: { en: 'Setpoint', fr: 'Consigne', de: 'Sollwert', es: 'Consigna' },
  humidity: { en: 'Humidity', fr: 'Humidité', de: 'Luftfeuchtigkeit', es: 'Humedad' },
  mode: { en: 'Mode', fr: 'Mode', de: 'Modus', es: 'Modo' },
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  comfort: { en: 'Comfort', fr: 'Confort', de: 'Komfort', es: 'Confort' },
  hold: { en: 'Hold', fr: 'Maintien', de: 'Halten', es: 'Mantener' },
  connection: {
    en: 'ecobee link',
    fr: 'Liaison ecobee',
    de: 'ecobee-Verbindung',
    es: 'Enlace ecobee',
  },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  heating: { en: 'Heating', fr: 'Chauffe', de: 'Heizt', es: 'Calentando' },
  cooling: { en: 'Cooling', fr: 'Refroidit', de: 'Kühlt', es: 'Enfriando' },
  fanOnly: { en: 'Fan', fr: 'Ventilation', de: 'Lüfter', es: 'Ventilador' },
  idle: { en: 'Idle', fr: 'Au repos', de: 'Inaktiv', es: 'En reposo' },
  lower: { en: 'Lower', fr: 'Baisser', de: 'Senken', es: 'Bajar' },
  raise: { en: 'Raise', fr: 'Monter', de: 'Erhöhen', es: 'Subir' },
  modeButton: { en: 'Mode', fr: 'Mode', de: 'Modus', es: 'Modo' },
  comfortButton: { en: 'Comfort', fr: 'Confort', de: 'Komfort', es: 'Confort' },
  heatTo: { en: 'Heat to', fr: 'Chauffer à', de: 'Heizen auf', es: 'Calentar a' },
  coolTo: { en: 'Cool to', fr: 'Refroidir à', de: 'Kühlen auf', es: 'Enfriar a' },
};

export const MESSAGES = {
  signedIn: (count) => ({
    en: `Signed in to ecobee: ${count} thermostat(s) found.`,
    fr: `Connecté à ecobee : ${count} thermostat(s) trouvé(s).`,
    de: `Bei ecobee angemeldet: ${count} Thermostat(e) gefunden.`,
    es: `Sesión iniciada en ecobee: ${count} termostato(s) encontrado(s).`,
  }),
  pinIssued: (pin, minutes) => ({
    en: `Your PIN is ${pin}. On ecobee.com, open My Apps, Add application, and enter it within ${minutes} minutes: the integration finishes by itself.`,
    fr: `Votre code PIN est ${pin}. Sur ecobee.com, ouvrez « My Apps », « Add application », et saisissez-le dans les ${minutes} minutes : l’intégration termine seule.`,
    de: `Deine PIN ist ${pin}. Öffne auf ecobee.com „My Apps“, „Add application“ und gib sie innerhalb von ${minutes} Minuten ein: Die Integration schließt den Rest selbst ab.`,
    es: `Su PIN es ${pin}. En ecobee.com, abra «My Apps», «Add application», e introdúzcalo en ${minutes} minutos: la integración termina sola.`,
  }),
  unavailable: (reason) => ({
    en: `ecobee did not answer as expected (${reason}). Try again later.`,
    fr: `ecobee n’a pas répondu comme prévu (${reason}). Réessayez plus tard.`,
    de: `ecobee hat nicht wie erwartet geantwortet (${reason}). Versuche es später erneut.`,
    es: `ecobee no ha respondido como se esperaba (${reason}). Inténtelo más tarde.`,
  }),
  setpointSet: (value) => ({
    en: `Setpoint ${value}`,
    fr: `Consigne ${value}`,
    de: `Sollwert ${value}`,
    es: `Consigna ${value}`,
  }),
  holdUntil: (when) => ({
    en: `Hold until ${when}`,
    fr: `Maintien jusqu’à ${when}`,
    de: `Gehalten bis ${when}`,
    es: `Mantenido hasta ${when}`,
  }),
  vacationUntil: (when) => ({
    en: `Vacation until ${when}`,
    fr: `Vacances jusqu’à ${when}`,
    de: `Urlaub bis ${when}`,
    es: `Vacaciones hasta ${when}`,
  }),
};

/** The hold descriptions that need no value. */
export const HOLD_TEXT = {
  schedule: { en: 'Schedule', fr: 'Programme', de: 'Zeitplan', es: 'Programa' },
  indefinite: {
    en: 'Permanent hold',
    fr: 'Maintien permanent',
    de: 'Dauerhaft gehalten',
    es: 'Mantenido sin límite',
  },
  hold: { en: 'Hold', fr: 'Maintien', de: 'Gehalten', es: 'Mantenido' },
  vacation: { en: 'Vacation', fr: 'Vacances', de: 'Urlaub', es: 'Vacaciones' },
  event: {
    en: 'Automatic event',
    fr: 'Événement automatique',
    de: 'Automatisches Ereignis',
    es: 'Evento automático',
  },
};

/** The feature names, one table per language (fixed at device creation). */
export const NAMES = {
  en: {
    temperature: 'Temperature',
    humidity: 'Humidity',
    heatSetpoint: 'Heat setpoint',
    coolSetpoint: 'Cool setpoint',
    mode: 'Mode',
    auxHeat: 'Auxiliary heat only',
    operatingState: 'Operating state',
    fan: 'Fan always on',
    fanRunning: 'Fan running',
    preset: 'Comfort setting',
    comfort: 'Current comfort setting',
    hold: 'Hold',
    occupancy: 'Occupancy',
  },
  fr: {
    temperature: 'Température',
    humidity: 'Humidité',
    heatSetpoint: 'Consigne de chauffage',
    coolSetpoint: 'Consigne de climatisation',
    mode: 'Mode',
    auxHeat: 'Chauffage d’appoint seul',
    operatingState: 'État de fonctionnement',
    fan: 'Ventilation permanente',
    fanRunning: 'Ventilation en marche',
    preset: 'Mode confort',
    comfort: 'Mode confort en cours',
    hold: 'Maintien',
    occupancy: 'Présence',
  },
  de: {
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    heatSetpoint: 'Sollwert Heizen',
    coolSetpoint: 'Sollwert Kühlen',
    mode: 'Modus',
    auxHeat: 'Nur Zusatzheizung',
    operatingState: 'Betriebszustand',
    fan: 'Lüfter dauerhaft an',
    fanRunning: 'Lüfter läuft',
    preset: 'Komforteinstellung',
    comfort: 'Aktuelle Komforteinstellung',
    hold: 'Halten',
    occupancy: 'Anwesenheit',
  },
  es: {
    temperature: 'Temperatura',
    humidity: 'Humedad',
    heatSetpoint: 'Consigna de calefacción',
    coolSetpoint: 'Consigna de refrigeración',
    mode: 'Modo',
    auxHeat: 'Solo calefacción auxiliar',
    operatingState: 'Estado de funcionamiento',
    fan: 'Ventilador siempre encendido',
    fanRunning: 'Ventilador en marcha',
    preset: 'Ajuste de confort',
    comfort: 'Ajuste de confort actual',
    hold: 'Mantener',
    occupancy: 'Presencia',
  },
};

/** The option labels of the mode and preset features, one table per language. */
export const LABELS = {
  en: { off: 'Off', heat: 'Heat', cool: 'Cool', auto: 'Auto', schedule: 'Schedule' },
  fr: {
    off: 'Arrêt',
    heat: 'Chauffage',
    cool: 'Climatisation',
    auto: 'Auto',
    schedule: 'Programme',
  },
  de: { off: 'Aus', heat: 'Heizen', cool: 'Kühlen', auto: 'Auto', schedule: 'Zeitplan' },
  es: { off: 'Apagado', heat: 'Calor', cool: 'Frío', auto: 'Auto', schedule: 'Programa' },
};

const LOCALES = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/**
 * A wall-clock moment of the thermostat ("2026-10-14", "18:00:00") written
 * the way each language reads it: the time alone when it is the day of
 * `today`, the day and the time otherwise.
 */
export function formatWhen(date, time, language, today) {
  const moment = new Date(`${date}T${(time ?? '00:00:00').padEnd(8, ':00')}Z`);
  if (Number.isNaN(moment.getTime())) {
    return date ?? '';
  }
  const locale = LOCALES[language] ?? LOCALES.en;
  const clock = new Intl.DateTimeFormat(locale, {
    // 6:00 PM in English, 18:00 / 08:30 elsewhere.
    hour: language === 'en' ? 'numeric' : '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(moment);
  if (date === today) {
    return clock;
  }
  const day = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(moment);
  return `${day} ${clock}`;
}

/** A multi-language text in one language (the configured one), English as fallback. */
export const pick = (text, language) => text[language] ?? text.en;

/** An Error whose message is a text in the configured language. */
export const failure = (text, language) => new Error(pick(text, language));
