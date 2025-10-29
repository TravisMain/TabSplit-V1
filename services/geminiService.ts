
import { GoogleGenAI, Type } from "@google/genai";
import { ReceiptData, BillSplit, ReceiptItem } from '../types.ts';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const model = "gemini-2.5-flash";

const receiptSchema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      description: "List of all items on the receipt.",
      items: {
        type: Type.OBJECT,
        properties: {
          item_name: { type: Type.STRING, description: "Name of the item." },
          quantity: { type: Type.NUMBER, description: "Quantity of the item." },
          price: { type: Type.NUMBER, description: "Total price for this line item (quantity * unit price), after any discounts." },
          confidence_score: { type: Type.NUMBER, description: "Confidence score (0.0 to 1.0) for the accuracy of this extracted line item." },
          notes: { type: Type.STRING, description: "Optional notes for the item, such as applied discounts, bundled item details, or ambiguities." },
        },
        required: ["item_name", "quantity", "price", "confidence_score"],
      },
    },
    subtotal: { type: Type.NUMBER, description: "The subtotal before tax and tip." },
    tax: { type: Type.NUMBER, description: "The total tax amount." },
    tip: { type: Type.NUMBER, description: "The total tip or gratuity amount." },
    total: { type: Type.NUMBER, description: "The final total amount (subtotal + tax + tip)." },
  },
  required: ["items", "subtotal", "tax", "tip", "total"],
};


export const parseReceipt = async (image: {
  inlineData: { data: string; mimeType: string };
}): Promise<ReceiptData> => {
  const prompt = `
You are an expert receipt-parsing AI. Analyze the receipt image with high precision and extract all line items, their quantities, prices, along with the subtotal, tax, tip, and total amount. Return the data in the specified JSON format.

**Key Extraction Rules:**
1.  **Line Items:** Extract each item's name, quantity, and total line price.
2.  **Confidence Score:** For each item, provide a \`confidence_score\` between 0.0 and 1.0. A score of 1.0 means you are absolutely certain about the item name, quantity, and price. A lower score indicates ambiguity, poor image quality for that line, or complex interpretation.
3.  **Discounts:** If a discount is applied to a specific item, the \`price\` for that item should be the *final price after the discount*. Mention the original price and the discount in the \`notes\` field (e.g., "Discounted from R12.00").
4.  **Bundled Items:** For bundled items like "Meal Deals," treat the bundle as a single item. List the main bundle name as the \`item_name\` and list the components in the \`notes\` field (e.g., "Includes a sandwich and a drink").
5.  **Ambiguity:** If an item name is handwritten or blurry, make your best guess for the \`item_name\` and explain the ambiguity in the \`notes\` field. Assign a lower \`confidence_score\`.
6.  **Totals Validation:** Critically, ensure the sum of all item prices, tax, and tip accurately equals the final total on the receipt. Adjust if necessary to ensure mathematical consistency.
`;

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        { text: prompt },
        image,
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: receiptSchema,
    },
  });

  const jsonText = response.text.trim();
  try {
    return JSON.parse(jsonText) as ReceiptData;
  } catch (e) {
    console.error("Failed to parse receipt JSON:", jsonText);
    throw new Error("The AI returned an invalid format. Please try another image.");
  }
};


const billSplitSchema = {
    type: Type.ARRAY,
    description: "An array of objects, where each object represents a person's share of the bill.",
    items: {
        type: Type.OBJECT,
        properties: {
            person_name: { type: Type.STRING, description: "The name of the person." },
            items: {
                type: Type.ARRAY,
                description: "Items assigned to this person.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        item_name: { type: Type.STRING },
                        price: { type: Type.NUMBER, description: "The portion of the price this person is responsible for." }
                    },
                    required: ["item_name", "price"],
                },
            },
            subtotal: { type: Type.NUMBER, description: "Sum of this person's item prices." },
            tax: { type: Type.NUMBER, description: "Proportional tax for this person." },
            tip: { type: Type.NUMBER, description: "Proportional tip for this person." },
            total: { type: Type.NUMBER, description: "Total amount this person owes." },
        },
        required: ["person_name", "items", "subtotal", "tax", "tip", "total"],
    }
};


export const updateBillSplit = async (
    receiptData: ReceiptData,
    currentSplit: BillSplit,
    userInput: string
  ): Promise<BillSplit> => {

    const prompt = `
You are an intelligent tab-splitting assistant. Your task is to update the bill assignments based on user commands. The final response must be an array of objects, one for each person, in the specified JSON format.

**Key Task:** Modify the bill split based on a user's instruction.

**Example Scenario:**
- A receipt has an item: { "item_name": "Nachos", "price": 15.00 }.
- The current split is empty.
- User says: "Alice, Bob, and Charlie shared the Nachos."
- Your task: You must add Alice, Bob, and Charlie to the bill split. Assign "Nachos" to each of them, but split the price. Each person's item entry should be { "item_name": "Nachos", "price": 5.00 }. Then, you must proportionally calculate their tax, tip, and total based on this R5.00 subtotal for each.

---

**Receipt Details:**
- Items: ${JSON.stringify(receiptData.items)}
- Subtotal: ${receiptData.subtotal}
- Tax: ${receiptData.tax}
- Tip: ${receiptData.tip}

**Current Bill Split State (an array of person objects):**
${JSON.stringify(currentSplit)}

**User Command:**
"${userInput}"

**Instructions:**
1.  Analyze the user's command to identify people and items.
2.  Update the bill split. If a command indicates an item is shared (e.g., "Alice and Bob shared..."), you **must** divide that item's total cost equally among the people involved. Each person's record should then include a fraction of that item's cost.
3.  When adding a person for the first time, create a new object for them in the array.
4.  For each person, calculate their new subtotal, which is the sum of the prices of all items assigned to them (including split portions).
5.  Distribute the total tax (${receiptData.tax}) and tip (${receiptData.tip}) proportionally based on each person's subtotal relative to the receipt's subtotal.
6.  Calculate the final total for each person (subtotal + tax share + tip share).
7.  Return the **entire updated bill split as a single JSON array**. Ensure all calculations are precise and the sum of individual totals equals the receipt's grand total.
`;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: billSplitSchema,
      }
    });

    const jsonText = response.text.trim();
    try {
      return JSON.parse(jsonText) as BillSplit;
    } catch (e) {
      console.error("Failed to parse bill split JSON:", jsonText);
      throw new Error("The AI returned an invalid format. Please try rephrasing your command.");
    }
  };