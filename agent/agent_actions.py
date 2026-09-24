import os
import time
import json
import requests
from playwright.sync_api import sync_playwright

def agent_order_blinkit_ambulance(lat, lng):
    """
    True Agentic Tool: Uses an LLM to read the DOM and decide the next action dynamically.
    Stops at checkout to prevent actual charges.
    """
    print("🤖 [AGENT] Taking Control: Launching true Agentic Browser (LLM Loop)...")
    
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if not gemini_key or gemini_key == "your_gemini_api_key_here":
        print("❌ [AGENT ERROR] GEMINI_API_KEY not found. Cannot run Agentic Computer Use.")
        return

    def ask_llm_next_action(page_text, current_url):
        prompt = f"""
You are an autonomous AI Agent dispatching an emergency medical response.
Current URL: {current_url}
Extracted Page Elements (Buttons, Links, Inputs):
{page_text[:3000]}

Your goal is to stage an ambulance booking OR add an emergency First Aid Kit/medicines to the cart. 
You can choose ONE of the following actions:
1. {{"action": "click", "target": "Exact text of the button/link to click"}}
2. {{"action": "type", "target": "Placeholder text of the input field", "value": "text to type"}}
3. {{"action": "done", "reason": "Reached checkout/booking stage or cannot proceed safely"}}

Respond ONLY with valid JSON.
"""
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
        try:
            resp = requests.post(url, json={"contents": [{"parts": [{"text": prompt}]}]}).json()
            raw_text = resp['candidates'][0]['content']['parts'][0]['text']
            
            # Extract JSON block
            if "```json" in raw_text:
                raw_text = raw_text.split("```json")[1].split("```")[0].strip()
            elif "```" in raw_text:
                raw_text = raw_text.split("```")[1].strip()
                
            return json.loads(raw_text)
        except Exception as e:
            return {"action": "done", "reason": f"LLM Parsing error: {e}"}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False) # Headless=False so interviewer can watch
        context = browser.new_context(
            geolocation={"latitude": float(lat), "longitude": float(lng)},
            permissions=["geolocation"]
        )
        page = context.new_page()
        
        try:
            # We start at the homepage because direct deep-links (like /ambulance) 
            # often 404 or get blocked by WAFs on automated browsers. 
            # The Agent will figure out how to search/navigate from here.
            page.goto("https://blinkit.com/")
            page.wait_for_timeout(3000)
            
            for step in range(5): # Bounded loop for safety (max 5 agent steps)
                print(f"🤖 [AGENT] Step {step+1}: Extracting DOM for LLM reasoning...")
                
                # Extract interactive elements for the LLM
                page_text = page.evaluate("""() => {
                    return Array.from(document.querySelectorAll('button, a, input, [role="button"], span'))
                        .map(el => {
                            let text = el.innerText || el.placeholder || '';
                            text = text.trim().replace(/\\n/g, ' ');
                            return text ? `${el.tagName}: ${text}` : '';
                        }).filter(t => t).join('\\n');
                }""")
                
                decision = ask_llm_next_action(page_text, page.url)
                print(f"🧠 [LLM DECIDED] {decision}")
                
                action = decision.get("action")
                
                if action == "done":
                    print(f"🛑 [AGENT] Goal achieved or halted: {decision.get('reason')}")
                    break
                    
                elif action == "click":
                    target = decision.get("target", "")
                    try:
                        print(f"   -> Executing Click on '{target}'")
                        page.locator(f"text='{target}'").first.click(timeout=3000)
                    except Exception as e:
                        print(f"   -> Click failed: {e}")
                        
                elif action == "type":
                    target = decision.get("target", "")
                    val = decision.get("value", "")
                    try:
                        print(f"   -> Executing Type '{val}' in '{target}'")
                        page.locator(f"input[placeholder*='{target}' i]").first.fill(val)
                        page.keyboard.press("Enter")
                    except Exception as e:
                        print(f"   -> Type failed: {e}")
                
                # Wait for the network/DOM to settle after the action
                page.wait_for_timeout(3000)
                
            print("🛑 [AGENT] Halting automation (Safety/PoC Stop). Leaving browser open for demo.")
            page.wait_for_timeout(10000)
            
        except Exception as e:
            print(f"❌ [AGENT ERROR] Browser automation failed: {e}")
        finally:
            print("🤖 [AGENT] Closing browser. PoC complete.")
            browser.close()

if __name__ == "__main__":
    # Test script locally
    agent_order_blinkit_ambulance(12.824589, 80.046896)
