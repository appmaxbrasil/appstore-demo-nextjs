/**
 * Dados fictícios para não ficar digitando a cada teste.
 *
 * Nada aqui pode ser de pessoa real: o repositório é público e a tela roda
 * atrás de um túnel aberto. O CPF `111.444.777-35` tem checksum válido (a
 * Appmax valida) e é o número de teste mais conhecido do Brasil; o e-mail usa
 * `example.com`, domínio reservado pela RFC 2606.
 */
export const TEST_CUSTOMER = {
  firstName: "Maria",
  lastName: "Teste",
  email: "comprador.teste@example.com",
  phone: "11999999999",
  documentNumber: "11144477735",
  postcode: "01310100",
  street: "Avenida Paulista",
  number: "1000",
  district: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

/** Cartão de teste da Appmax em sandbox. */
export const TEST_CARD = {
  number: "4000000000000010",
  holderName: "MARIA TESTE",
  expirationMonth: "12",
  expirationYear: "2031",
  cvv: "123",
};
