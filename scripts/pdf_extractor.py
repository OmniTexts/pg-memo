import fitz  # PyMuPDF
import os
import sys
import json
import base64
import hashlib
from pathlib import Path

# 尝试导入 zhipuai，如果不存在则提示
try:
    from zhipuai import ZhipuAI
except ImportError:
    ZhipuAI = None

def get_image_hash(image_bytes):
    return hashlib.md5(image_bytes).hexdigest()

def encode_image(image_bytes):
    return base64.b64encode(image_bytes).decode('utf-8')

def process_pdf(pdf_path, media_dir=None, base_url="media/", api_key=None, model="glm-4v-flash"):
    doc = fitz.open(pdf_path)
    client = ZhipuAI(api_key=api_key) if (api_key and ZhipuAI) else None
    
    # 确保媒体目录存在
    if media_dir:
        os.makedirs(media_dir, exist_ok=True)

    full_content = []
    hash_to_text = {} # 用于识别去重
    saved_images = [] # 记录本次保存的所有图片名

    for page_num in range(len(doc)):
        page = doc[page_num]
        blocks = page.get_text("blocks")
        image_list = page.get_images(full=True)[:5] # 保持限流
        
        page_items = []
        for b in blocks:
            page_items.append({"type": "text", "y": b[1], "content": b[4]})
            
        for img in image_list:
            xref = img[0]
            base_image = doc.extract_image(xref)
            image_bytes = base_image["image"]
            ext = base_image["ext"]
            img_hash = get_image_hash(image_bytes)
            
            # 1. 保存图片到本地 (如果指定了 media_dir)
            img_filename = f"{img_hash}.{ext}"
            img_display_path = f"{base_url.rstrip('/')}/{img_filename}"
            
            if media_dir:
                img_path = os.path.join(media_dir, img_filename)
                if not os.path.exists(img_path):
                    with open(img_path, "wb") as f:
                        f.write(image_bytes)
                if img_filename not in saved_images:
                    saved_images.append(img_filename)

            img_rects = page.get_image_rects(xref)
            if img_rects:
                rect = img_rects[0]
                
                # 2. VLM 识别
                if client and img_hash not in hash_to_text:
                    try:
                        response = client.chat.completions.create(
                            model=model,
                            messages=[{
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": "如果这是一个汉字或卦象，请直接输出该字或卦名；如果是图表，请用一句话描述。不要输出多余废话。"},
                                    {"type": "image_url", "image_url": {"url": encode_image(image_bytes)}}
                                ]
                            }]
                        )
                        hash_to_text[img_hash] = response.choices[0].message.content.strip()
                    except Exception:
                        hash_to_text[img_hash] = ""

                description = hash_to_text.get(img_hash, "")
                # 3. 生成 Markdown 引用 (使用 img_display_path)
                alt_text = f"图片描述: {description}" if description else "图片"
                page_items.append({"type": "image", "y": rect.y0, "content": f"![{alt_text}]({img_display_path})"})

        page_items.sort(key=lambda x: x["y"])
        text_parts = [item["content"] for item in page_items]
        full_content.append(f"[Page {page_num + 1}]\n" + "".join(text_parts))

    return {
        "content": "\n\n".join(full_content),
        "metadata": {
            "pages": len(doc), 
            "vlm_enhanced": True if client else False, 
            "media_dir": media_dir, 
            "base_url": base_url,
            "saved_images": saved_images
        }
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing file path"}))
        sys.exit(1)

    pdf_file = sys.argv[1]
    # 第 2 个参数: media 目录
    target_media_dir = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "None" else None
    # 第 3 个参数: base_url
    target_base_url = sys.argv[3] if len(sys.argv) > 3 else "media/"
    
    key = os.environ.get("ZHIPU_API_KEY")
    vlm_model = os.environ.get("VISION_MODEL", "glm-4v-flash")
    
    try:
        result = process_pdf(pdf_file, media_dir=target_media_dir, base_url=target_base_url, api_key=key, model=vlm_model)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
