package io.zakiai.workspace.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Records what the app runs on its everyday path: the start, «الدردشة» (scrolled, one conversation opened), «اليوم», «الشغل» with its tabs
 * (projects, calendar, approvals, tickets), «المكتبة». The emulator must be signed in, with the local site running for the staging flavor.
 * Words are the bar's own Arabic labels (the same words a person taps).
 */
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule
    val rule = BaselineProfileRule()

    @Test
    fun generate() = rule.collect(
        packageName = InstrumentationRegistry.getArguments().getString("targetAppId") ?: "io.zakiai.workspace.staging",
        includeInStartupProfile = true,
    ) {
        pressHome()
        startActivityAndWait()
        device.wait(Until.hasObject(By.text("الدردشة")), 15_000)

        // the chat list, scrolled, and one conversation
        scroll(device)
        device.findObject(By.clickable(true).hasDescendant(By.textStartsWith("S")))?.click()
        device.waitForIdle()
        Thread.sleep(1_500)
        scroll(device)
        device.pressBack()
        device.waitForIdle()

        tap(device, "اليوم")
        scroll(device)
        tap(device, "الشغل")
        for (tab in listOf("المشاريع", "التقويم", "الموافقات", "التذاكر")) {
            tap(device, tab)
            scroll(device)
        }
        tap(device, "المكتبة")
        scroll(device)
        tap(device, "الدردشة")
    }

    private fun tap(device: UiDevice, text: String) {
        device.wait(Until.findObject(By.text(text)), 5_000)?.click()
        device.waitForIdle()
        Thread.sleep(1_200)
    }

    private fun scroll(device: UiDevice) {
        val list = device.findObject(By.scrollable(true)) ?: return
        list.setGestureMargin(device.displayWidth / 5)
        list.fling(Direction.DOWN)
        device.waitForIdle()
        list.fling(Direction.UP)
        device.waitForIdle()
    }
}
