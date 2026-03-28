from flask import Flask, jsonify, request
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime

app = Flask(__name__)
CORS(app)

# Initialize Firebase
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

# ─────────────────────────────────────────
# SNACKS ENDPOINTS
# ─────────────────────────────────────────

@app.route('/api/snacks', methods=['GET'])
def get_snacks():
    snacks = []
    docs = db.collection('snacks').stream()
    for doc in docs:
        snack = doc.to_dict()
        snack['id'] = doc.id
        snacks.append(snack)
    return jsonify(snacks)

@app.route('/api/snacks', methods=['POST'])
def add_snack():
    data = request.json
    doc_ref = db.collection('snacks').add({
        'name': data['name'],
        'category': data.get('category', 'general'),
        'price': data['price'],
        'stock': data['stock'],
        'threshold': data.get('threshold', 10),
        'total_sold': 0,
        'image_url': data.get('image_url', '')
    })
    return jsonify({'id': doc_ref[1].id, 'message': 'Snack added'}), 201

@app.route('/api/snacks/<snack_id>', methods=['PUT'])
def update_snack(snack_id):
    data = request.json
    db.collection('snacks').document(snack_id).update(data)
    return jsonify({'message': 'Snack updated'})

@app.route('/api/snacks/<snack_id>', methods=['DELETE'])
def delete_snack(snack_id):
    db.collection('snacks').document(snack_id).delete()
    return jsonify({'message': 'Snack deleted'})

# ─────────────────────────────────────────
# TRANSACTIONS / PURCHASE RECORDING
# ─────────────────────────────────────────

@app.route('/api/purchase', methods=['POST'])
def record_purchase():
    data = request.json
    snack_id = data['snack_id']
    quantity = data.get('quantity', 1)

    snack_ref = db.collection('snacks').document(snack_id)
    snack = snack_ref.get().to_dict()

    if not snack:
        return jsonify({'error': 'Snack not found'}), 404
    if snack['stock'] < quantity:
        return jsonify({'error': 'Insufficient stock'}), 400

    # Update stock and total_sold
    snack_ref.update({
        'stock': firestore.Increment(-quantity),
        'total_sold': firestore.Increment(quantity)
    })

    # Record transaction
    db.collection('transactions').add({
        'snack_id': snack_id,
        'snack_name': snack['name'],
        'quantity': quantity,
        'price': snack['price'],
        'total': snack['price'] * quantity,
        'timestamp': datetime.utcnow()
    })

    return jsonify({'message': 'Purchase recorded', 'remaining_stock': snack['stock'] - quantity})

# ─────────────────────────────────────────
# STATISTICS / ANALYTICS
# ─────────────────────────────────────────

@app.route('/api/stats', methods=['GET'])
def get_stats():
    snacks = []
    total_revenue = 0
    total_sold = 0
    low_stock = []
    best_sellers = []

    docs = db.collection('snacks').stream()
    for doc in docs:
        s = doc.to_dict()
        s['id'] = doc.id
        snacks.append(s)
        total_sold += s.get('total_sold', 0)
        total_revenue += s.get('total_sold', 0) * s.get('price', 0)
        if s.get('stock', 0) <= s.get('threshold', 10):
            low_stock.append({'name': s['name'], 'stock': s['stock'], 'id': doc.id})

    best_sellers = sorted(snacks, key=lambda x: x.get('total_sold', 0), reverse=True)[:5]

    # Category breakdown
    categories = {}
    for s in snacks:
        cat = s.get('category', 'general')
        categories[cat] = categories.get(cat, 0) + s.get('total_sold', 0)

    return jsonify({
        'total_revenue': total_revenue,
        'total_sold': total_sold,
        'total_products': len(snacks),
        'low_stock_alerts': low_stock,
        'best_sellers': best_sellers[:5],
        'category_breakdown': categories
    })

@app.route('/api/transactions', methods=['GET'])
def get_transactions():
    limit = int(request.args.get('limit', 20))
    txns = []
    docs = db.collection('transactions').order_by('timestamp', direction=firestore.Query.DESCENDING).limit(limit).stream()
    for doc in docs:
        t = doc.to_dict()
        t['id'] = doc.id
        if 'timestamp' in t and t['timestamp']:
            t['timestamp'] = t['timestamp'].isoformat()
        txns.append(t)
    return jsonify(txns)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)