import { camelToSnake, snakeToCamel } from 'effect/String';

export const SQL_NAMES = { transformQueryNames: camelToSnake, transformResultNames: snakeToCamel };
