export class PaymentProvider {
  async getClientConfig() { throw new Error('Not implemented'); }
  async createPayout(_payload) { throw new Error('Not implemented'); }
  async createTopup(_payload) { throw new Error('Not implemented'); }
  async getTopupStatus(_paymentId) { throw new Error('Not implemented'); }
}
