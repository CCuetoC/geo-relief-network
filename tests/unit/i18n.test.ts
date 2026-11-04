import assert from "node:assert/strict";
import test from "node:test";
import { resolveCatalogSlug } from "@/domain/catalog-localization";
import { dictionaryKeys, notificationMessage } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/locale";

test("a saved locale takes precedence over browser language", () => {
  assert.equal(resolveLocale("es", "en-US,en;q=0.9"), "es");
  assert.equal(resolveLocale("en", "es-PE,es;q=0.9"), "en");
});

test("browser language is only an initial suggestion and unsupported languages fall back to English", () => {
  assert.equal(resolveLocale(undefined, "es-PE,es;q=0.9,en;q=0.8"), "es");
  assert.equal(resolveLocale(undefined, "fr-FR,fr;q=0.9"), "en");
  assert.equal(resolveLocale(undefined, null), "en");
});

test("English and Spanish dictionaries expose the same keys", () => {
  assert.deepEqual(dictionaryKeys("en").sort(), dictionaryKeys("es").sort());
});

test("water and agua resolve to one stable catalog slug", () => {
  const products = [{
    slug: "bottled-water",
    fallbackName: "Bottled water",
    localized: {
      en: { name: "Bottled water", aliases: ["water", "bottles of water"] },
      es: { name: "Agua embotellada", aliases: ["agua", "botellas de agua"] },
    },
  }];
  assert.equal(resolveCatalogSlug({ name: "water" }, products), "bottled-water");
  assert.equal(resolveCatalogSlug({ name: "AGUA" }, products), "bottled-water");
  assert.equal(resolveCatalogSlug({ slug: "not-in-catalog", name: "agua" }, products), null);
});

test("notification copy follows the selected channel locale", () => {
  const payload = { quantity: 3, productName: "Agua", productNames: { en: "Bottled water", es: "Agua embotellada" }, pointName: "Demo point", expiresAt: "2026-11-04T16:30:00.000Z", timeZone: "America/Lima" };
  assert.match(notificationMessage("en", "FIFO_OFFER_CREATED", payload), /Bottled water/);
  assert.match(notificationMessage("es", "FIFO_OFFER_CREATED", payload), /Agua embotellada/);
});
