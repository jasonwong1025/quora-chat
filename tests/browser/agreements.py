import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base = os.environ["QUORA_UI_URL"]
artifacts = Path(os.environ["UI_ARTIFACTS"])
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base + "/orbyte/agreement-preview/quotes?r=preview-request")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text("Requirements changed after this draft was prepared.", exact=False)).to_be_visible()
    expect(page.get_by_role("button", name="Approve & send")).to_have_count(0)
    page.screenshot(path=str(artifacts / "outdated-draft.png"), full_page=True)
    page.get_by_role("button", name="Waive with a reason").click()
    page.get_by_label("Reason for waiving this requirement").fill("Confirm user count during paid discovery")
    page.get_by_role("button", name="Waive", exact=True).click()
    expect(page.get_by_text("(waived: Confirm user count during paid discovery)", exact=True)).to_be_visible()
    page.get_by_role("button", name="Draft now", exact=True).click()
    expect(page.get_by_role("button", name="Approve & send")).to_be_visible()
    expect(page.get_by_text("Quotation · requirements version 3", exact=False)).to_be_visible()
    page.screenshot(path=str(artifacts / "reviewed-draft.png"), full_page=True)
    page.goto(base + "/orbyte/agreement-preview/work/preview-job")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("button", name="I reviewed the scope and tasks")).to_be_visible()
    expect(page.get_by_text("Suggested tasks for the revised scope", exact=True)).to_be_visible()
    page.screenshot(path=str(artifacts / "revised-project.png"), full_page=True)
    page.get_by_role("button", name="I reviewed the scope and tasks").click()
    expect(page.get_by_role("button", name="I reviewed the scope and tasks")).to_have_count(0)
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(base + "/orbyte/agreement-preview/quotes?r=preview-request")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("button", name="Approve & send")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile page overflows horizontally"
    page.screenshot(path=str(artifacts / "mobile-draft.png"), full_page=True)
    page.set_viewport_size({"width": 1280, "height": 900})
    response = page.request.get(base + "/api/quotes/signed-quote/pdf")
    assert response.ok, response.status
    pdf = artifacts / "agreement.pdf"
    pdf.write_bytes(response.body())
    text = subprocess.check_output(["pdftotext", str(pdf), "-"], text=True)
    assert "Requirements included in this quotation" in text
    assert "办公室" in text, text
    subprocess.run(["pdftoppm", "-scale-to", "1400", "-singlefile", "-png", str(pdf), str(artifacts / "agreement-pdf")], check=True)
    page.get_by_role("button", name="Approve & send").click()
    expect(page.get_by_text("Approved · awaiting signature", exact=False)).to_be_visible()
    pdf_link = page.get_by_role("link", name="PDF", exact=True).first.get_attribute("href")
    quote_id = pdf_link.split("/")[3]
    page.goto(base + "/sign/" + quote_id)
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text("Requirements included in this quotation", exact=True)).to_be_visible()
    expect(page.get_by_text("Waived - Confirm user count during paid discovery", exact=False)).to_be_visible()
    page.get_by_role("checkbox").check()
    page.locator("canvas").scroll_into_view_if_needed()
    canvas = page.locator("canvas").bounding_box()
    page.mouse.move(canvas["x"] + 20, canvas["y"] + 40)
    page.mouse.down()
    page.mouse.move(canvas["x"] + 100, canvas["y"] + 60, steps=8)
    page.mouse.up()
    page.get_by_role("button", name="Sign & accept").click()
    expect(page.get_by_text("Signed — thank you!", exact=True)).to_be_visible()
    page.screenshot(path=str(artifacts / "signed-requirements.png"), full_page=True)
    assert not errors, errors
    browser.close()
print("Browser checks passed: outdated approval, reasoned waiver, current draft, PIC review, mobile layout")
