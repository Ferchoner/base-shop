/** How long a link lives, as the emails say it: `24 horas`, `1 hora`, `30 minutos` or `1 minuto`. */
export function lifetimeInWords(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}
