package io.zakiai.workspace

import io.zakiai.workspace.core.net.failureOf
import io.zakiai.workspace.feature.mfg.EditOrderBody
import io.zakiai.workspace.feature.mfg.MaterialAnswer
import io.zakiai.workspace.feature.mfg.MfgWords
import io.zakiai.workspace.feature.mfg.OrdersView
import io.zakiai.workspace.feature.mfg.Overview
import io.zakiai.workspace.feature.mfg.Q8
import io.zakiai.workspace.feature.mfg.ReportsView
import io.zakiai.workspace.feature.mfg.editBody
import io.zakiai.workspace.feature.mfg.looksQty
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** N6 batch 8: «مخزون التصنيع» writes the ledger's numbers as the site does, says its precise refusals, and reads no price it was not sent. */
class MfgTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    @Test fun `quantities are micro-units grouped with their fraction trimmed (formatQty)`() {
        assertEquals("1,250.5", Q8.qty(1_250_500_000))
        assertEquals("72", Q8.qty(72_000_000))
        assertEquals("-3", Q8.qty(-3_000_000))
        assertEquals("0.000001", Q8.qty(1))
        assertEquals("0", Q8.qty(0))
        // 48 boxes in cartons of 24: 2
        assertEquals("2", Q8.inUnit(48_000_000, 24, 1))
        assertEquals("1.333", Q8.inUnit(4_000_000, 3, 1))
    }

    @Test fun `money is minor units with the currency's own decimals (formatMinor), 0-9 on an Arabic phone`() {
        val before = Locale.getDefault()
        try {
            Locale.setDefault(Locale("ar"))
            assertEquals("12.500", Q8.money(12_500, "JOD"))
            assertEquals("1,234.56", Q8.money(123_456, "USD"))
            assertEquals("0.007", Q8.money(7, "KWD"))
            assertTrue(Q8.moneyText(12_500, "JOD").endsWith(MfgWords.all["mfg.cur.JOD"]!!))
        } finally {
            Locale.setDefault(before)
        }
    }

    @Test fun `the precise refusal of a field is said in the ledger's own words`() {
        val f = failureOf(422, """{"error":"validation.failed","message":"validation.failed","details":[{"path":"qty","message":"mfg.e.insufficient"}]}""")
        assertEquals("mfg.e.insufficient", f.detail)
        assertEquals(MfgWords.all["mfg.e.insufficient"], Q8.refusal(f.detail, f.message))
        assertEquals("x", Q8.refusal(null, "x"))
        assertEquals("x", Q8.refusal("unknown.key", "x"))
    }

    @Test fun `without the cost key the server sends no price, and the phone reads none`() {
        val o = json.decodeFromString<Overview>("""{"spaceId":"s","spaceName":"م","canEdit":true,"canCost":false,"materials":[{"id":"m","name":"علب","baseUnit":"علبة","balanceMicro":72000000,"low":false,"unpricedMicro":0,"cost":null}],"suppliers":[],"pending":[]}""")
        assertNull(o.materials[0].cost)
        val m = json.decodeFromString<MaterialAnswer>("""{"material":{"id":"m","name":"علب","baseUnit":"علبة","balanceMicro":1,"canEdit":true,"canCost":false,"cost":null,"lots":[{"id":"l","receivedOn":"2026-11-01","qtyMicro":1,"enteredQtyMicro":1,"enteredUnitLabel":"علبة","cost":null,"costPending":true,"priceHistory":[]}],"movements":[{"id":"v","kind":"RECEIVE","qtyMicro":1,"valueMinor":null,"canReverse":true}],"counts":[]}}""")
        assertNull(m.material.lots[0].cost)
        assertNull(m.material.movements[0].valueMinor)
        assertTrue(m.material.lots[0].costPending)
    }

    @Test fun `the ledger opens natively`() {
        val base = "https://workspace.zakiai.io"
        assertEquals(Destination.Mfg, Links.destinationOf("/manufacturing", base))
        assertEquals(Destination.MfgMaterial("m1"), Links.destinationOf("/manufacturing/materials/m1", base))
        assertEquals("5 كانون الثاني 2026", Q8.dmy("2026-01-05"))
        assertEquals(Destination.MfgPart("orders"), Links.destinationOf("/manufacturing/orders", base))
        assertEquals(Destination.MfgPart("recipes"), Links.destinationOf("/manufacturing/recipes/", base))
        assertEquals(Destination.MfgPart("reports"), Links.destinationOf("/manufacturing/reports?from=2026-01-01&to=2026-01-31", base))
    }

    @Test fun `a draft's edit sends only what changed, an emptied note clears it`() {
        assertNull(editBody("", "10", "10", "x", "x"))
        assertEquals(EditOrderBody(qty = "12"), editBody("", " 12 ", "10", "x", "x"))
        assertEquals(EditOrderBody(note = ""), editBody("", "10", "10", "  ", "x"))
        assertEquals(EditOrderBody(recipeId = "r2"), editBody("r2", "10", "10", "", null))
        // with nulls left out, the server reads «unchanged» for what is not sent
        val sent = Json { explicitNulls = false; encodeDefaults = true }.encodeToString(EditOrderBody.serializer(), EditOrderBody(note = ""))
        assertEquals("""{"note":""}""", sent)
    }

    @Test fun `a typed quantity must be a positive number before it is sent`() {
        assertTrue(looksQty("48") && looksQty("0.5") && looksQty(" 2.25 "))
        assertTrue(!looksQty("0") && !looksQty("") && !looksQty("1,5") && !looksQty("-3") && !looksQty("1.") && !looksQty("abc"))
    }

    @Test fun `an order or a report read without the cost key carries no money`() {
        val o = json.decodeFromString<OrdersView>("""{"spaceId":"s","spaceName":"م","canEdit":true,"canCost":false,"orders":[{"id":"o","seq":3,"status":"ISSUED","recipeId":"r","recipeName":"صابون","version":2,"outputUnit":"قطعة","plannedMicro":10000000,"actualMicro":null,"lines":[{"id":"l","materialId":"m","materialName":"زيت","baseUnit":"لتر","perUnitMicro":1,"requiredMicro":10,"balanceMicro":5,"unpricedMicro":0,"issuedMicro":10,"enough":true}],"costIncomplete":true,"cost":null,"canComplete":true,"finished":null}],"recipes":[]}""")
        assertNull(o.orders[0].cost)
        assertTrue(o.orders[0].costIncomplete)
        assertEquals("ISSUED", o.orders[0].status)
        val r = json.decodeFromString<ReportsView>("""{"spaceId":"s","spaceName":"م","canCost":false,"period":{"from":"2026-10-27","to":"2026-11-26"},"valuation":[{"materialId":"m","name":"زيت","baseUnit":"لتر","qtyMicro":5,"unpricedMicro":0,"cost":null}],"valuationTotals":null,"consumption":[{"materialId":"m","name":"زيت","baseUnit":"لتر","qtyMicro":10,"viaOrdersMicro":10,"cost":null}],"orders":[{"orderId":"o","seq":3,"status":"ISSUED","recipeName":"صابون","outputUnit":"قطعة","plannedMicro":1,"actualMicro":null,"day":"2026-11-20","costIncomplete":false,"cost":null}],"low":[]}""")
        assertNull(r.valuation[0].cost)
        assertNull(r.valuationTotals)
        assertNull(r.consumption[0].cost)
        assertNull(r.orders[0].cost)
    }
}
